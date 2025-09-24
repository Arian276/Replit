// === BarrileteCosmico TV Backend ===
// === Fragmento 1/10 ===

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const admin = require('firebase-admin');
const { Server } = require('socket.io');

const app = express();
const server = require('http').createServer(app);

// ===== WEBSOCKETS PARA CONTADORES REALES =====
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ===== SISTEMA EN MEMORIA PARA TODO =====
// Contadores reales de espectadores por canal
const realViewerCounts = new Map(); // channelId -> count actual
const viewerSessions = new Map(); // channelId -> Set(sessionIds)
const sessionDetails = new Map(); // sessionId -> {channelId, userAgent, ip, connectedAt}

// Categorías dinámicas configurables
let categories = [
  {
    id: 'sports',
    name: 'Deportes',
    description: 'Canales deportivos argentinos',
    color: '#36B5D8',
    icon: '⚽',
    order: 1,
    isActive: true,
  },
  {
    id: 'news',
    name: 'Noticias',
    description: 'Canales informativos',
    color: '#F77A2B',
    icon: '📺',
    order: 2,
    isActive: true,
  },
  {
    id: 'entertainment',
    name: 'Entretenimiento',
    description: 'Variedad y entretenimiento',
    color: '#E91E63',
    icon: '🎬',
    order: 3,
    isActive: true,
  },
];

// Servidores múltiples configurables
let servers = [
  {
    id: 'main',
    name: 'Servidor Principal BarrileteCosmico',
    description: 'Servidor principal con canales deportivos',
    baseUrl: process.env.REPL_URL || 'http://localhost:5000',
    isActive: true,
    isPrimary: true,
    priority: 1,
  },
];

// Likes reales por canal
const realLikes = new Map(); // channelId -> count actual
const userLikes = new Map(); // sessionId -> Set(channelIds que ha likeado)

// === SESIONES REST (heartbeat de la app) - SEPARADAS DEL WS ===
const activeViewers = new Map(); // streamId -> Set(viewerIds)
const viewerSessionsREST = new Map(); // viewerId -> { streamId, lastPing }

// ===== WEBSOCKETS - CONTADORES REALES =====
io.on('connection', (socket) => {
  console.log(`👤 Usuario conectado: ${socket.id}`);

  // Join a un canal específico para ver contadores reales
  socket.on('join-channel', (data) => {
    const { channelId, userAgent, country } = data;

    // Almacenar detalles de sesión
    sessionDetails.set(socket.id, {
      channelId,
      userAgent: userAgent || 'Unknown',
      ip: socket.handshake.address,
      connectedAt: new Date().toISOString(),
      country: country || 'AR',
    });

    // Agregar a sesiones del canal
    if (!viewerSessions.has(channelId)) {
      viewerSessions.set(channelId, new Set());
    }
    viewerSessions.get(channelId).add(socket.id);

    // Actualizar contador real
    const currentCount = viewerSessions.get(channelId).size;
    realViewerCounts.set(channelId, currentCount);

    // Join al room del canal
    socket.join(`channel_${channelId}`);

    console.log(
      `📺 Usuario ${socket.id} se unió a canal ${channelId} (${currentCount} espectadores)`
    );

    // Emitir contador actualizado a todos en el canal
    io.to(`channel_${channelId}`).emit('viewer-count-update', {
      channelId,
      count: currentCount,
      timestamp: new Date().toISOString(),
    });

    // Confirmar conexión
    socket.emit('joined-channel', {
      channelId,
      viewerCount: currentCount,
    });
  });

  // Leave canal
  socket.on('leave-channel', (channelId) => {
    handleUserLeave(socket.id, channelId);
  });

  // Like real en canal
  socket.on('like-channel', (data) => {
    const { channelId } = data;
    const sessionId = socket.id;

    // Verificar si ya dio like
    if (!userLikes.has(sessionId)) {
      userLikes.set(sessionId, new Set());
    }

    const userChannelLikes = userLikes.get(sessionId);

    if (!userChannelLikes.has(channelId)) {
      // Nuevo like
      userChannelLikes.add(channelId);

      // Incrementar contador real
      const currentLikes = realLikes.get(channelId) || 0;
      realLikes.set(channelId, currentLikes + 1);

      console.log(
        `❤️ Like real en canal ${channelId} (total: ${currentLikes + 1})`
      );

      // Emitir a todos en el canal
      io.to(`channel_${channelId}`).emit('like-update', {
        channelId,
        likes: currentLikes + 1,
        timestamp: new Date().toISOString(),
      });

      socket.emit('like-confirmed', { channelId, likes: currentLikes + 1 });
    } else {
      socket.emit('like-error', { message: 'Ya diste like a este canal' });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`👤 Usuario desconectado: ${socket.id}`);

    // Buscar en qué canal estaba
    const sessionDetail = sessionDetails.get(socket.id);
    if (sessionDetail) {
      handleUserLeave(socket.id, sessionDetail.channelId);
    }
  });
});

// Función para manejar cuando un usuario deja un canal
function handleUserLeave(socketId, channelId) {
  if (viewerSessions.has(channelId)) {
    viewerSessions.get(channelId).delete(socketId);

    const newCount = viewerSessions.get(channelId).size;
    realViewerCounts.set(channelId, newCount);

    console.log(
      `📺 Usuario ${socketId} dejó canal ${channelId} (${newCount} espectadores)`
    );

    // Emitir contador actualizado
    io.to(`channel_${channelId}`).emit('viewer-count-update', {
      channelId,
      count: newCount,
      timestamp: new Date().toISOString(),
    });
  }

  // Limpiar datos de sesión
  sessionDetails.delete(socketId);
  userLikes.delete(socketId);
}

// Función para obtener estadísticas reales de un canal
function getRealChannelStats(channelId) {
  return {
    viewerCount: realViewerCounts.get(channelId) || 0,
    likes: realLikes.get(channelId) || 0,
    activeSessions: viewerSessions.get(channelId)?.size || 0,
  };
}

// ===== ROUTER ADMIN CENTRALIZADO =====
const adminRouter = express.Router();
const PORT = process.env.PORT || 5000;

// ===== CONFIGURACIÓN DE FIREBASE FCM =====
let firebaseApp = null;
let fcmEnabled = false;

try {
  // Intentar inicializar Firebase si hay configuración disponible
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
    fcmEnabled = true;
    console.log('🔥 Firebase FCM inicializado exitosamente');
  } else {
    console.log('⚠️ Firebase FCM no configurado - usando modo simulación');
  }
} catch (error) {
  console.log('⚠️ Error inicializando Firebase FCM:', error.message);
  console.log('📱 Continuando en modo simulación');
}

// Base de datos de tokens de dispositivos (en memoria para demo, usar DB real en producción)
// Estructura correcta: Map<userId, Set<token>>
const deviceTokens = new Map();
const deviceInfo = new Map(); // Map<token, info>

// Sistema de autenticación básico para admin (en producción usar JWT o similar)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// Verificar que la clave de admin esté configurada
if (!ADMIN_API_KEY) {
  console.error('🚨 ERROR CRÍTICO: ADMIN_API_KEY no está configurada');
  console.error(
    '💡 Configura la variable de entorno ADMIN_API_KEY para acceder al panel admin'
  );
  console.error('📝 Ejemplo: export ADMIN_API_KEY="tu_clave_super_secreta_aqui"');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Middleware de autenticación para endpoints sensibles
function requireAuth(req, res, next) {
  // Si no hay ADMIN_API_KEY configurada, rechazar acceso
  if (!ADMIN_API_KEY) {
    return res.status(503).json({
      error: 'Servicio no disponible',
      message: 'Sistema de autenticación no configurado correctamente',
    });
  }

  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Permitir mediante header Authorization: Bearer TOKEN o X-API-Key: TOKEN
  if (
    (authHeader && authHeader === `Bearer ${ADMIN_API_KEY}`) ||
    (apiKey && apiKey === ADMIN_API_KEY)
  ) {
    next();
  } else {
    res.status(401).json({
      error: 'Acceso no autorizado',
      message: 'Se requiere autenticación válida para este endpoint',
      hint: 'Incluye X-API-Key header o Authorization: Bearer <token>',
    });
  }
}

// Rate limiting básico (en producción usar express-rate-limit)
const requestCounts = new Map();
function rateLimit(maxRequests = 10, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requestCounts.has(ip)) {
      requestCounts.set(ip, []);
    }

    const requests = requestCounts.get(ip);
    const windowStart = now - windowMs;

    // Limpiar requests antiguos
    const recentRequests = requests.filter((time) => time > windowStart);
    requestCounts.set(ip, recentRequests);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Demasiadas solicitudes',
        message: `Máximo ${maxRequests} solicitudes por minuto`,
      });
    }

    recentRequests.push(now);
    next();
  };
}

// Configuración de multer para subida de archivos
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    // Aceptar solo archivos .m3u8 o .m3u
    if (file.originalname.match(/\.(m3u8|m3u)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos .m3u8 o .m3u'), false);
    }
  },
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Servir archivos estáticos SEGUROS (NO todo el repositorio)
app.use('/public', express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/channels', express.static('channels'));

// Endpoint específico para servir upload.html de forma segura
app.get('/upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// Endpoint específico para servir APK de forma segura
app.get('/apk', (req, res) => {
  res.redirect('/api/download/apk');
});

// Endpoint para descargar APK
app.get('/api/download/apk', (req, res) => {
  const apkPath = path.join(__dirname, 'BarrileteCosmico-TV.apk');

  // Verificar que el archivo existe
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({
      error: 'APK no encontrado',
      message:
        'El APK aún no está disponible. Intenta nuevamente en unos minutos.',
    });
  }

  // Configurar headers para descarga
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="BarrileteCosmico-TV.apk"'
  );
  res.setHeader('Content-Length', fs.statSync(apkPath).size);

  // Enviar archivo
  const fileStream = fs.createReadStream(apkPath);
  fileStream.pipe(res);

  console.log('📱 APK descargado por usuario');
});

// Endpoint para verificar estado del APK
app.get('/api/apk/status', (req, res) => {
  const apkPath = path.join(__dirname, 'BarrileteCosmico-TV.apk');
  const isReady = fs.existsSync(apkPath);

  if (isReady) {
    const stats = fs.statSync(apkPath);
    res.json({
      status: 'ready',
      size: Math.round(stats.size / 1024 / 1024) + ' MB',
      modified: stats.mtime,
      downloadUrl: '/apk',
    });
  } else {
    res.json({
      status: 'not_available',
      message: 'APK aún no está disponible',
    });
  }
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 2/10 ===

// ✅ FUNCIÓN MEJORADA PARA VERIFICAR STREAMS - MÁS PERMISIVA
async function verifyStreamWithFFmpeg(streamUrl, timeout = 20000) {
  return new Promise((resolve) => {
    // Verificar con ffmpeg directamente - SIN pre-verificación con curl
    const ffmpegCommand = `timeout ${timeout / 1000} ffmpeg -i "${streamUrl}" -t 2 -f null - 2>&1`;

    exec(ffmpegCommand, (error, stdout, stderr) => {
      // CONDICIONES MUY PERMISIVAS para aceptar diferentes formatos
      const hasValidStream =
        stderr.includes('Stream #') || // Información de stream
        stderr.includes('Video:') || // Stream de video
        stderr.includes('Audio:') || // Stream de audio
        stderr.includes('Duration:') || // Duración del contenido
        stderr.includes('Input #0') || // Input detectado
        stderr.includes('Opening') || // Conectando al stream
        stderr.includes('Protocol') || // Protocolo detectado
        stderr.includes('format') || // Formato detectado
        stderr.includes('bitrate') || // Bitrate presente
        stderr.includes('fps') || // FPS presente
        stderr.includes('Hz') || // Frecuencia de audio
        stderr.includes('kb/s'); // Bitrate en kb/s

      // TAMBIÉN aceptar si hay conexión exitosa aunque haya timeout
      const hasConnection =
        !stderr.includes('Connection refused') &&
        !stderr.includes('Name or service not known') &&
        !stderr.includes('No route to host') &&
        !stderr.includes('Network is unreachable');

      // Verificar específicamente formatos de URL válidos
      const isValidUrlFormat =
        streamUrl.includes('/play') || // Cualquier URL con /play
        streamUrl.includes('play/') || // play/xxxx
        streamUrl.includes('index.m3u8') || // archivos .m3u8
        streamUrl.includes('.mpd') || // archivos DASH
        streamUrl.includes('.m3u') || // archivos M3U
        streamUrl.includes('playlist'); // playlists

      if ((hasValidStream || hasConnection) && isValidUrlFormat) {
        console.log(`✅ Stream ACTIVO: ${streamUrl.substring(0, 60)}...`);
        resolve(true);
      } else {
        console.log(`❌ Stream INACTIVO: ${streamUrl.substring(0, 60)}...`);
        if (stderr) {
          console.log(
            `   Info: ${stderr
              .substring(0, 150)
              .replace(/\n/g, ' ')}`
          );
        }
        resolve(false);
      }
    });
  });
}

// Base de datos en memoria para los canales (en producción usar MongoDB/PostgreSQL)
let channels = [
  {
    id: 'tnt-sports-hd',
    title: 'TNT Sports HD',
    description:
      'Transmisión en vivo del canal TNT Sports en alta definición. Fútbol argentino y internacional.',
    streamUrl:
      'https://cdn.live.tn.com.ar/live/c7eds/TNTSports/SA_Live_dash_enc_2A/TNTSports.mpd',
    thumbnailUrl: 'https://example.com/tnt-sports-thumb.jpg',
    isLive: true,
    category: 'sports',
    viewerCount: 1500,
    country: 'AR',
    language: 'es',
    quality: 'HD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'espn-premium-hd',
    title: 'ESPN Premium HD',
    description:
      'Canal premium de ESPN con los mejores partidos de fútbol argentino y Copa Libertadores.',
    streamUrl:
      'https://cdn.live.espn.com.ar/live/espn-premium/hls/playlist.m3u8',
    thumbnailUrl: 'https://example.com/espn-premium-thumb.jpg',
    isLive: true,
    category: 'sports',
    viewerCount: 2100,
    country: 'AR',
    language: 'es',
    quality: 'HD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'directv-sport',
    title: 'DirecTV Sports',
    description:
      'Deportes en vivo con la mejor calidad. Fútbol argentino, Copa Sudamericana y más.',
    streamUrl:
      'https://edge.cvattv.com.ar/live/c3eds/DirectTVSports/SA_Live_dash_enc/DirectTVSports.mpd',
    thumbnailUrl: 'https://example.com/directv-sports-thumb.jpg',
    isLive: true,
    category: 'sports',
    viewerCount: 1800,
    country: 'AR',
    language: 'es',
    quality: 'HD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'fox-sports-hd',
    title: 'Fox Sports HD',
    description:
      'Transmisiones deportivas de Fox Sports. Premier League, Champions League y fútbol internacional.',
    streamUrl: 'https://live.foxsportsla.tv/foxsportshd/playlist.m3u8',
    thumbnailUrl: 'https://example.com/fox-sports-thumb.jpg',
    isLive: true,
    category: 'sports',
    viewerCount: 1350,
    country: 'AR',
    language: 'es',
    quality: 'HD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'espn-hd',
    title: 'ESPN HD',
    description:
      'Canal principal de ESPN con noticias deportivas y transmisiones en vivo.',
    streamUrl: 'https://cdn.live.espn.com.ar/live/espn/hls/playlist.m3u8',
    thumbnailUrl: 'https://example.com/espn-thumb.jpg',
    isLive: true,
    category: 'sports',
    viewerCount: 1100,
    country: 'AR',
    language: 'es',
    quality: 'HD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'BarrileteCosmico TV Backend API',
    timestamp: new Date().toISOString(),
    channels: channels.length,
  });
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 3/10 ===

// GET /api/streams - Obtener todos los canales con contadores REALES
app.get('/api/streams', (req, res) => {
  try {
    const { category } = req.query;

    // Filtrar por categoría si se especifica
    let filteredChannels = channels;
    if (category && category !== 'all') {
      filteredChannels = channels.filter((ch) => ch.category === category);
    }

    // CONTADORES 100% REALES - No datos simulados
    const channelsWithRealStats = filteredChannels.map((channel) => {
      const realStats = getRealChannelStats(channel.id);
      return {
        ...channel,
        viewerCount: realStats.viewerCount,
        likes: realStats.likes,
        activeSessions: realStats.activeSessions,
        realTimeData: true,
        lastUpdated: new Date().toISOString(),
      };
    });

    res.json({
      channels: channelsWithRealStats,
      totalChannels: channelsWithRealStats.length,
      realTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canales' });
  }
});

// GET /api/streams/featured - Obtener canales destacados
app.get('/api/streams/featured', (req, res) => {
  try {
    // Destacados por umbral de viewers actuales
    const featured = channels.filter((channel) => channel.viewerCount > 1500);
    res.json(featured);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canales destacados' });
  }
});

// GET /api/streams/:id - Obtener canal por ID con estadísticas reales
app.get('/api/streams/:id', (req, res) => {
  try {
    const channel = channels.find((c) => c.id === req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    // ESTADÍSTICAS 100% REALES - Solo datos verdaderos
    const realStats = getRealChannelStats(channel.id);
    const channelWithStats = {
      ...channel,
      viewerCount: realStats.viewerCount,
      likes: realStats.likes,
      activeSessions: realStats.activeSessions,
      realTimeData: true,
      lastUpdated: new Date().toISOString(),
    };

    res.json(channelWithStats);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canal' });
  }
});

// GET /api/streams/search - Buscar canales
app.get('/api/streams/search', (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    const q = String(query).toLowerCase();
    const results = channels.filter(
      (channel) =>
        channel.title.toLowerCase().includes(q) ||
        channel.description.toLowerCase().includes(q) ||
        channel.category.toLowerCase().includes(q)
    );

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Error en la búsqueda' });
  }
});

// GET /api/streams/category/:category - Obtener canales por categoría
app.get('/api/streams/category/:category', (req, res) => {
  try {
    const { category } = req.params;
    const filtered = channels.filter(
      (channel) => channel.category.toLowerCase() === category.toLowerCase()
    );
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Error al filtrar por categoría' });
  }
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 4/10 ===

// POST /api/streams/:id/join - Unirse a un stream (incrementar contador)
app.post('/api/streams/:id/join', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const viewerId = req.body.viewerId || uuidv4();

    // Verificar que el stream existe
    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Inicializar set de viewers si no existe
    if (!activeViewers.has(streamId)) {
      activeViewers.set(streamId, new Set());
    }

    // Agregar viewer al stream
    activeViewers.get(streamId).add(viewerId);
    viewerSessionsREST.set(viewerId, {
      streamId,
      lastPing: Date.now(),
    });

    // Actualizar contador en el canal
    stream.viewerCount = activeViewers.get(streamId).size;
    stream.updatedAt = new Date().toISOString();

    console.log(
      `📺 Viewer ${viewerId} se unió a ${stream.title} (${stream.viewerCount} viewers)`
    );

    res.json({
      viewerId,
      viewerCount: stream.viewerCount,
      streamId,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al unirse al stream' });
  }
});

// POST /api/streams/:id/leave - Salir de un stream (decrementar contador)
app.post('/api/streams/:id/leave', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { viewerId } = req.body;

    if (!viewerId) {
      return res.status(400).json({ error: 'viewerId requerido' });
    }

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Remover viewer
    if (activeViewers.has(streamId)) {
      activeViewers.get(streamId).delete(viewerId);
      stream.viewerCount = activeViewers.get(streamId).size;
      stream.updatedAt = new Date().toISOString();
    }

    viewerSessionsREST.delete(viewerId);

    console.log(
      `📺 Viewer ${viewerId} salió de ${stream.title} (${stream.viewerCount} viewers)`
    );

    res.json({
      viewerCount: stream.viewerCount,
      streamId,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al salir del stream' });
  }
});

// POST /api/streams/:id/ping - Mantener sesión activa (heartbeat)
app.post('/api/streams/:id/ping', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { viewerId } = req.body;

    if (!viewerId || !viewerSessionsREST.has(viewerId)) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    // Actualizar último ping
    viewerSessionsREST.get(viewerId).lastPing = Date.now();

    const stream = channels.find((c) => c.id === streamId);
    const viewerCount = activeViewers.get(streamId)?.size || 0;

    res.json({ viewerCount, streamId });
  } catch (error) {
    res.status(500).json({ error: 'Error en ping' });
  }
});

// GET /api/streams/:id/viewers - Obtener contador actual de espectadores
app.get('/api/streams/:id/viewers', (req, res) => {
  try {
    const { id: streamId } = req.params;

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    const viewerCount = activeViewers.get(streamId)?.size || 0;

    res.json({
      streamId,
      viewerCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener viewers' });
  }
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 5/10 ===

// ===== SISTEMA DE LIKES =====

// Base de datos en memoria para likes
// Estructura: { streamId: { likes: number, likedBy: Set(userIds) } }
const likesDatabase = new Map();

// POST /api/streams/:id/like - Dar o quitar like a un stream
app.post('/api/streams/:id/like', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Inicializar likes para el stream si no existe
    if (!likesDatabase.has(streamId)) {
      likesDatabase.set(streamId, {
        likes: 0,
        likedBy: new Set(),
      });
    }

    const streamLikes = likesDatabase.get(streamId);
    const hasLiked = streamLikes.likedBy.has(userId);

    if (hasLiked) {
      // Quitar like
      streamLikes.likes = Math.max(0, streamLikes.likes - 1);
      streamLikes.likedBy.delete(userId);
    } else {
      // Agregar like
      streamLikes.likes += 1;
      streamLikes.likedBy.add(userId);
    }

    console.log(
      `${hasLiked ? '👎' : '👍'} Usuario ${userId} ${
        hasLiked ? 'quitó like' : 'dio like'
      } a ${stream.title} (${streamLikes.likes} likes)`
    );

    res.json({
      streamId,
      likes: streamLikes.likes,
      liked: !hasLiked,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error toggle like:', error);
    res.status(500).json({ error: 'Error al procesar like' });
  }
});

// GET /api/streams/:id/likes - Obtener likes de un stream
app.get('/api/streams/:id/likes', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { userId } = req.query;

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Inicializar si no existe
    if (!likesDatabase.has(streamId)) {
      likesDatabase.set(streamId, {
        likes: 0,
        likedBy: new Set(),
      });
    }

    const streamLikes = likesDatabase.get(streamId);

    res.json({
      streamId,
      likes: streamLikes.likes,
      liked: userId ? streamLikes.likedBy.has(userId) : false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error obteniendo likes:', error);
    res.status(500).json({ error: 'Error al obtener likes' });
  }
});

// GET /api/streams/likes/summary - Resumen de likes de todos los streams
app.get('/api/streams/likes/summary', (req, res) => {
  try {
    const summary = {};

    for (const [streamId, likesData] of likesDatabase.entries()) {
      summary[streamId] = {
        likes: likesData.likes,
        streamId,
      };
    }

    res.json(summary);
  } catch (error) {
    console.error('Error obteniendo summary de likes:', error);
    res.status(500).json({ error: 'Error al obtener summary de likes' });
  }
});

// ===== SISTEMA DE CHAT =====

// Base de datos en memoria para chat
// Estructura: { streamId: [ { id, username, message, timestamp, colorHex } ] }
const chatDatabase = new Map();

// POST /api/streams/:id/chat - Enviar mensaje de chat
app.post('/api/streams/:id/chat', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { username, message } = req.body;

    if (!username || !message) {
      return res.status(400).json({ error: 'Username y message son requeridos' });
    }

    if (message.length > 200) {
      return res.status(400).json({ error: 'Mensaje muy largo (máx 200 caracteres)' });
    }

    if (message.trim().length < 2) {
      return res.status(400).json({ error: 'Mensaje muy corto (mín 2 caracteres)' });
    }

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Inicializar chat para el stream si no existe
    if (!chatDatabase.has(streamId)) {
      chatDatabase.set(streamId, []);
    }

    const chatMessages = chatDatabase.get(streamId);

    const newMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      username: username.trim(),
      message: message.trim(),
      timestamp: Date.now(),
      colorHex: '#00BFFF', // Color fijo por ahora
    };

    chatMessages.push(newMessage);

    // Mantener solo los últimos 100 mensajes por stream
    if (chatMessages.length > 100) {
      chatMessages.splice(0, chatMessages.length - 100);
    }

    console.log(`💬 ${username} en ${stream.title}: ${message}`);

    res.json({
      streamId,
      message: newMessage,
      totalMessages: chatMessages.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// GET /api/streams/:id/chat - Obtener mensajes de chat
app.get('/api/streams/:id/chat', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Inicializar si no existe
    if (!chatDatabase.has(streamId)) {
      chatDatabase.set(streamId, []);
    }

    const chatMessages = chatDatabase.get(streamId);
    const startIndex = Math.max(0, parseInt(offset));
    const endIndex = startIndex + parseInt(limit);
    const paginatedMessages = chatMessages.slice(startIndex, endIndex);

    res.json({
      streamId,
      messages: paginatedMessages,
      totalMessages: chatMessages.length,
      offset: startIndex,
      limit: parseInt(limit),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 6/10 ===

// ===== ENDPOINTS ADMIN MOVIDOS AL ROUTER PROTEGIDO =====

// DELETE /api/admin/streams/:id/chat - Limpiar chat de un stream
adminRouter.delete('/streams/:id/chat', (req, res) => {
  try {
    const { id: streamId } = req.params;

    const stream = channels.find((c) => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }

    // Limpiar mensajes
    chatDatabase.set(streamId, []);

    console.log(`🧹 Chat limpiado para ${stream.title} por admin`);

    res.json({
      streamId,
      message: 'Chat limpiado exitosamente',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error limpiando chat:', error);
    res.status(500).json({ error: 'Error al limpiar chat' });
  }
});

// PUT /api/admin/streams/:id - Actualizar canal
adminRouter.put('/streams/:id', (req, res) => {
  try {
    const channelIndex = channels.findIndex((c) => c.id === req.params.id);
    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const updatedChannel = {
      ...channels[channelIndex],
      ...req.body,
      id: req.params.id, // Mantener ID original
      updatedAt: new Date().toISOString(),
    };

    channels[channelIndex] = updatedChannel;

    console.log(`📝 Canal actualizado por admin: ${updatedChannel.title}`);

    res.json(updatedChannel);
  } catch (error) {
    console.error('Error actualizando canal:', error);
    res.status(500).json({ error: 'Error al actualizar canal' });
  }
});

// DELETE /api/admin/streams/:id - Eliminar canal
adminRouter.delete('/streams/:id', (req, res) => {
  try {
    const channelIndex = channels.findIndex((c) => c.id === req.params.id);
    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const deletedChannel = channels.splice(channelIndex, 1)[0];

    console.log(`🗑️ Canal eliminado por admin: ${deletedChannel.title}`);

    res.json({
      message: 'Canal eliminado exitosamente',
      channel: deletedChannel,
    });
  } catch (error) {
    console.error('Error eliminando canal:', error);
    res.status(500).json({ error: 'Error al eliminar canal' });
  }
});

// POST /api/admin/streams - Crear nuevo canal
adminRouter.post('/streams', (req, res) => {
  try {
    const {
      title,
      description,
      streamUrl,
      thumbnailUrl,
      category = 'sports',
      quality = 'HD',
      country = 'AR',
      language = 'es',
    } = req.body;

    if (!title || !description || !streamUrl) {
      return res
        .status(400)
        .json({ error: 'Faltan campos obligatorios: title, description, streamUrl' });
    }

    // Verificar que la categoría existe
    const categoryExists = categories.find((cat) => cat.id === category);
    if (!categoryExists) {
      return res.status(400).json({
        error: `Categoría '${category}' no existe. Usa: ${categories
          .map((c) => c.id)
          .join(', ')}`,
      });
    }

    const newChannel = {
      id: uuidv4(),
      title,
      description,
      streamUrl,
      thumbnailUrl: thumbnailUrl || '',
      isLive: true,
      category,
      viewerCount: Math.floor(Math.random() * 100) + 50,
      country,
      language,
      quality,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    channels.push(newChannel);

    // Inicializar contadores reales para el nuevo canal
    realViewerCounts.set(newChannel.id, 0);
    realLikes.set(newChannel.id, 0);

    console.log(`📺 Nuevo canal creado por admin: ${newChannel.title} en categoría ${category}`);

    res.status(201).json(newChannel);
  } catch (error) {
    console.error('Error creando canal:', error);
    res.status(500).json({ error: 'Error al crear canal' });
  }
});
// === BarrileteCosmico TV Backend ===
// === Fragmento 7/10 ===

// ===== GESTIÓN DE CATEGORÍAS DINÁMICAS =====

// GET /api/categories - Obtener todas las categorías
app.get('/api/categories', (req, res) => {
  try {
    const categoriesWithCount = categories
      .filter((cat) => cat.isActive)
      .map((category) => ({
        ...category,
        channelCount: channels.filter((ch) => ch.category === category.id).length,
      }))
      .sort((a, b) => a.order - b.order);

    res.json(categoriesWithCount);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// GET /api/admin/categories - Obtener todas las categorías (incluyendo inactivas)
adminRouter.get('/categories', (req, res) => {
  try {
    const categoriesWithCount = categories.map((category) => ({
      ...category,
      channelCount: channels.filter((ch) => ch.category === category.id).length,
    }));

    res.json(categoriesWithCount);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// POST /api/admin/categories - Crear nueva categoría
adminRouter.post('/categories', (req, res) => {
  try {
    const { name, description, color, icon, order } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nombre es obligatorio' });
    }

    // Generar ID único basado en el nombre
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Verificar que no existe
    if (categories.find((cat) => cat.id === id)) {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    }

    const newCategory = {
      id,
      name,
      description: description || '',
      color: color || '#36B5D8',
      icon: icon || '📺',
      order: order || categories.length + 1,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    categories.push(newCategory);
    categories.sort((a, b) => a.order - b.order);

    console.log(`🏷️ Nueva categoría creada: ${name}`);

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error creando categoría:', error);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// PUT /api/admin/categories/:id - Actualizar categoría
adminRouter.put('/categories/:id', (req, res) => {
  try {
    const categoryIndex = categories.findIndex((cat) => cat.id === req.params.id);
    if (categoryIndex === -1) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    const { name, description, color, icon, order, isActive } = req.body;

    categories[categoryIndex] = {
      ...categories[categoryIndex],
      name: name || categories[categoryIndex].name,
      description:
        description !== undefined ? description : categories[categoryIndex].description,
      color: color || categories[categoryIndex].color,
      icon: icon || categories[categoryIndex].icon,
      order: order !== undefined ? order : categories[categoryIndex].order,
      isActive: isActive !== undefined ? isActive : categories[categoryIndex].isActive,
      updatedAt: new Date().toISOString(),
    };

    categories.sort((a, b) => a.order - b.order);

    console.log(`🏷️ Categoría actualizada: ${categories[categoryIndex].name}`);

    res.json(categories[categoryIndex]);
  } catch (error) {
    console.error('Error actualizando categoría:', error);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

// DELETE /api/admin/categories/:id - Eliminar categoría
adminRouter.delete('/categories/:id', (req, res) => {
  try {
    const categoryIndex = categories.findIndex((cat) => cat.id === req.params.id);
    if (categoryIndex === -1) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    const categoryId = req.params.id;

    // Verificar si hay canales en esta categoría
    const channelsInCategory = channels.filter((ch) => ch.category === categoryId);
    if (channelsInCategory.length > 0) {
      return res.status(400).json({
        error: `No se puede eliminar. Hay ${channelsInCategory.length} canales en esta categoría.`,
      });
    }

    const deletedCategory = categories.splice(categoryIndex, 1)[0];

    console.log(`🗑️ Categoría eliminada: ${deletedCategory.name}`);

    res.json({ message: 'Categoría eliminada exitosamente', category: deletedCategory });
  } catch (error) {
    console.error('Error eliminando categoría:', error);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});
// ===== SISTEMA DE GESTIÓN DE PLAYLISTS M3U8 =====

// Función para parsear archivos M3U8
function parseM3U8Content(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line);
  const parsedChannels = [];
  let currentChannel = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Línea de información del canal (#EXTINF)
    if (line.startsWith('#EXTINF:')) {
      const info = line.substring(8); // Remover '#EXTINF:'

      // Extraer duración (primer número)
      const durationMatch = info.match(/^(-?\d+(?:\.\d+)?)/);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : -1;

      // Atributos después de la coma
      const attributesSection = info.substring(info.indexOf(',') + 1);

      // Atributos comunes
      const titleMatch = attributesSection.match(/tvg-name="([^"]+)"/);
      const logoMatch  = attributesSection.match(/tvg-logo="([^"]+)"/);
      const groupMatch = attributesSection.match(/group-title="([^"]+)"/);
      const idMatch    = attributesSection.match(/tvg-id="([^"]+)"/);

      // El nombre del canal está al final
      const nameParts = attributesSection.split(',');
      const channelName = nameParts[nameParts.length - 1].trim();

      currentChannel = {
        id: idMatch ? idMatch[1] : generateChannelIdFromName(channelName),
        title: titleMatch ? titleMatch[1] : channelName,
        description: `Canal ${channelName} - Transmisión en vivo`,
        thumbnailUrl: logoMatch
          ? logoMatch[1]
          : "https://via.placeholder.com/300x200/1a1a1a/ffffff?text=" + encodeURIComponent(channelName),
        isLive: true,
        category: groupMatch ? groupMatch[1].toLowerCase() : "general",
        viewerCount: Math.floor(Math.random() * 1000) + 50,
        country: "AR",
        language: "es",
        quality: "HD",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    // Línea de URL del stream
    else if (line.startsWith('http') && currentChannel.id) {
      currentChannel.streamUrl = line;
      parsedChannels.push({ ...currentChannel });
      currentChannel = {}; // reset
    }
  }

  return parsedChannels;
}

// Evitar choque de nombres con tu helper global:
function generateChannelIdFromName(channelName) {
  return channelName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30) + '-' + Math.random().toString(36).substr(2, 6);
}

// POST /api/playlists/upload - Subir archivo M3U/M3U8
app.post('/api/playlists/upload', upload.single('playlist'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');

    const newChannels = parseM3U8Content(content);
    if (newChannels.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'No se encontraron canales válidos en el archivo' });
    }

    // Agregar evitando duplicados (por id, título o URL)
    let addedCount = 0;
    newChannels.forEach(nc => {
      const exists = channels.find(ch =>
        ch.id === nc.id || ch.title === nc.title || ch.streamUrl === nc.streamUrl
      );
      if (!exists) {
        channels.push(nc);
        addedCount++;
      }
    });

    fs.unlinkSync(filePath);

    console.log(`📺 Agregados ${addedCount} canales nuevos desde archivo M3U8`);

    res.json({
      message: 'Playlist procesada exitosamente',
      channelsFound: newChannels.length,
      channelsAdded: addedCount,
      totalChannels: channels.length
    });
  } catch (error) {
    console.error('Error procesando playlist:', error);
    res.status(500).json({ error: 'Error procesando el archivo de playlist' });
  }
});

// POST /api/playlists/url - Cargar playlist desde URL
app.post('/api/playlists/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    if (!/^https?:\/\/.+\.(m3u8?|txt)$/i.test(url)) {
      return res.status(400).json({ error: 'URL debe apuntar a un archivo .m3u8 o .m3u' });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(400).json({ error: `Error descargando playlist: ${response.statusText}` });
    }

    const content = await response.text();
    const newChannels = parseM3U8Content(content);
    if (newChannels.length === 0) {
      return res.status(400).json({ error: 'No se encontraron canales válidos en la playlist' });
    }

    let addedCount = 0;
    newChannels.forEach(nc => {
      const exists = channels.find(ch =>
        ch.id === nc.id || ch.title === nc.title || ch.streamUrl === nc.streamUrl
      );
      if (!exists) {
        channels.push(nc);
        addedCount++;
      }
    });

    console.log(`📺 Agregados ${addedCount} canales nuevos desde URL: ${url}`);

    res.json({
      message: 'Playlist cargada exitosamente desde URL',
      url,
      channelsFound: newChannels.length,
      channelsAdded: addedCount,
      totalChannels: channels.length
    });
  } catch (error) {
    console.error('Error cargando playlist desde URL:', error);
    res.status(500).json({ error: 'Error cargando playlist desde URL' });
  }
});

// GET /api/playlists/export - Exportar como M3U8
app.get('/api/playlists/export', (req, res) => {
  try {
    let m3u8Content = '#EXTM3U\n';
    channels.forEach(channel => {
      m3u8Content += `#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${channel.title}" tvg-logo="${channel.thumbnailUrl}" group-title="${channel.category}",${channel.title}\n`;
      m3u8Content += `${channel.streamUrl}\n`;
    });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="barriletecosmico-channels.m3u8"');
    res.send(m3u8Content);
  } catch (error) {
    console.error('Error exportando playlist:', error);
    res.status(500).json({ error: 'Error generando playlist' });
  }
});

// DELETE /api/channels/:id - Eliminar canal
app.delete('/api/channels/:id', (req, res) => {
  try {
    const { id } = req.params;
    const before = channels.length;
    channels = channels.filter(ch => ch.id !== id);

    if (channels.length === before) return res.status(404).json({ error: 'Canal no encontrado' });

    console.log(`🗑️ Canal ${id} eliminado`);
    res.json({ message: 'Canal eliminado exitosamente', channelId: id, totalChannels: channels.length });
  } catch (error) {
    console.error('Error eliminando canal:', error);
    res.status(500).json({ error: 'Error eliminando canal' });
  }
});

// POST /api/channels/clear - Limpiar todos los canales
app.post('/api/channels/clear', (req, res) => {
  try {
    const removed = channels.length;
    channels = [];
    console.log(`🧹 Eliminados ${removed} canales`);
    res.json({ message: 'Todos los canales han sido eliminados', channelsRemoved: removed, totalChannels: 0 });
  } catch (error) {
    console.error('Error limpiando canales:', error);
    res.status(500).json({ error: 'Error limpiando canales' });
  }
});
// ===== SISTEMA DE MONITOREO AUTOMÁTICO DE ARCHIVOS M3U8 =====

function initializeFileWatcher() {
  const channelsDir = './channels';

  // Crear carpeta si no existe
  if (!fs.existsSync(channelsDir)) {
    fs.mkdirSync(channelsDir, { recursive: true });
  }

  // Procesar archivos existentes al iniciar
  processExistingFiles(channelsDir);

  // Monitorear nuevos archivos
  const watcher = chokidar.watch(channelsDir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });

  watcher
    .on('add', (filePath) => {
      if (/\.(m3u8?|m3u)$/i.test(filePath)) {
        console.log(`📁 Nuevo archivo M3U8 detectado: ${filePath}`);
        processChannelFile(filePath);
      }
    })
    .on('change', (filePath) => {
      if (/\.(m3u8?|m3u)$/i.test(filePath)) {
        console.log(`📁 Archivo M3U8 modificado: ${filePath}`);
        processChannelFile(filePath);
      }
    })
    .on('unlink', (filePath) => {
      if (/\.(m3u8?|m3u)$/i.test(filePath)) {
        console.log(`📁 Archivo M3U8 eliminado: ${filePath}`);
      }
    })
    .on('error', (error) => {
      console.error('🔥 Error en file watcher:', error);
    });

  console.log(`👁️ Monitoreando carpeta: ${channelsDir}`);
}

function processExistingFiles(channelsDir) {
  try {
    const files = fs.readdirSync(channelsDir);
    const m3uFiles = files.filter(file => /\.(m3u8?|m3u)$/i.test(file));

    if (m3uFiles.length > 0) {
      console.log(`📂 Procesando ${m3uFiles.length} archivos M3U8 existentes...`);
      m3uFiles.forEach(file => processChannelFile(path.join(channelsDir, file)));
    }
  } catch (error) {
    console.error('Error procesando archivos existentes:', error);
  }
}

async function processChannelFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const newChannels = parseM3U8Content(content);

    if (newChannels.length === 0) {
      console.log(`⚠️ No se encontraron canales válidos en: ${filePath}`);
      return;
    }

    const fileName = path.basename(filePath);
    console.log(`✅ Archivo: ${fileName}`);
    console.log(`📺 ${newChannels.length} canales encontrados (agregando/evitando duplicados)...`);

    let addedCount = 0;
    newChannels.forEach(nc => {
      const exists = channels.find(ch =>
        ch.id === nc.id || ch.title === nc.title || ch.streamUrl === nc.streamUrl
      );
      if (!exists) {
        channels.push(nc);
        addedCount++;
        console.log(`✅ Canal agregado: ${nc.title}`);
      } else {
        console.log(`⚠️ Canal duplicado ignorado: ${nc.title}`);
      }
    });

    console.log(`📺 ${addedCount} canales agregados. Total: ${channels.length}`);
  } catch (error) {
    console.error(`❌ Error procesando ${filePath}:`, error.message);
  }
}

// ===== PANEL DE ADMINISTRACIÓN WEB =====
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-panel-full-control.html'));
});

// Redirigir raíz al admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ===== APLICAR PROTECCIÓN CENTRALIZADA AL ROUTER ADMIN =====
app.use('/api/admin', requireAuth, rateLimit(30, 60000), adminRouter);
// ===== HELPERS =====
function generateChannelId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    + '-' + Math.random().toString(36).substr(2, 6);
}

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Ruta 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BarrileteCosmico TV Backend corriendo en puerto ${PORT}`);
  console.log(`📺 Canales disponibles: ${channels.length}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 API endpoints: http://localhost:${PORT}/api/streams`);
  console.log(`🎛️ Panel Admin: http://localhost:${PORT}/admin`);
  console.log(`📁 Carpeta de monitoreo: ./channels/`);
  console.log(`🔌 WebSockets activados para contadores reales`);

  // 👇 IMPORTANTE: ahora sí existe antes de llamarla
  initializeFileWatcher();
});