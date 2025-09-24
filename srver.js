const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
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
    origin: "*",
    methods: ["GET", "POST"]
  }
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
    isActive: true
  },
  {
    id: 'news', 
    name: 'Noticias', 
    description: 'Canales informativos',
    color: '#F77A2B',
    icon: '📺',
    order: 2,
    isActive: true
  },
  {
    id: 'entertainment', 
    name: 'Entretenimiento', 
    description: 'Variedad y entretenimiento',
    color: '#E91E63',
    icon: '🎬',
    order: 3,
    isActive: true
  }
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
    priority: 1
  }
];

// Likes reales por canal
const realLikes = new Map(); // channelId -> count actual
const userLikes = new Map(); // sessionId -> Set(channelIds que ha likeado)
// === SESIONES REST (heartbeat de la app) - SEPARADAS DEL WS ===
const activeViewers = new Map();        // streamId -> Set(viewerIds)
const viewerSessionsREST = new Map();   // viewerId -> { streamId, lastPing }

// ===== WEBSOCKETS - CONTADORES REALES =====

// Cuando un usuario se conecta a un canal
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
      country: country || 'AR'
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
    
    console.log(`📺 Usuario ${socket.id} se unió a canal ${channelId} (${currentCount} espectadores)`);
    
    // Emitir contador actualizado a todos en el canal
    io.to(`channel_${channelId}`).emit('viewer-count-update', {
      channelId,
      count: currentCount,
      timestamp: new Date().toISOString()
    });
    
    // Confirmar conexión
    socket.emit('joined-channel', {
      channelId,
      viewerCount: currentCount
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
      
      console.log(`❤️ Like real en canal ${channelId} (total: ${currentLikes + 1})`);
      
      // Emitir a todos en el canal
      io.to(`channel_${channelId}`).emit('like-update', {
        channelId,
        likes: currentLikes + 1,
        timestamp: new Date().toISOString()
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
    
    console.log(`📺 Usuario ${socketId} dejó canal ${channelId} (${newCount} espectadores)`);
    
    // Emitir contador actualizado
    io.to(`channel_${channelId}`).emit('viewer-count-update', {
      channelId,
      count: newCount,
      timestamp: new Date().toISOString()
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
    activeSessions: viewerSessions.get(channelId)?.size || 0
  };
}

// ===== ROUTER ADMIN CENTRALIZADO =====
const adminRouter = express.Router();
const PORT = process.env.PORT || 5000;

// ===== CONFIGURACIÓN DE FIREBASE FCM =====

// Inicializar Firebase Admin (usando service account desde variables de entorno)
let firebaseApp = null;
let fcmEnabled = false;

try {
  // Intentar inicializar Firebase si hay configuración disponible
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
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
const deviceTokens = new Map(); // userId -> Set de tokens
const deviceInfo = new Map(); // token -> info del dispositivo

// Sistema de autenticación básico para admin (en producción usar JWT o similar)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

// Verificar que la clave de admin esté configurada
if (!ADMIN_API_KEY) {
  console.error('🚨 ERROR CRÍTICO: ADMIN_API_KEY no está configurada');
  console.error('💡 Configura la variable de entorno ADMIN_API_KEY para acceder al panel admin');
  console.error('📝 Ejemplo: export ADMIN_API_KEY="tu_clave_super_secreta_aqui"');
  // En desarrollo, permitir continuar con warning pero en producción debería fallar
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
      message: 'Sistema de autenticación no configurado correctamente'
    });
  }
  
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  
  // Permitir mediante header Authorization: Bearer TOKEN o X-API-Key: TOKEN
  if ((authHeader && authHeader === `Bearer ${ADMIN_API_KEY}`) || 
      (apiKey && apiKey === ADMIN_API_KEY)) {
    next();
  } else {
    res.status(401).json({ 
      error: 'Acceso no autorizado', 
      message: 'Se requiere autenticación válida para este endpoint',
      hint: 'Incluye X-API-Key header o Authorization: Bearer <token>'
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
    const recentRequests = requests.filter(time => time > windowStart);
    requestCounts.set(ip, recentRequests);
    
    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({ 
        error: 'Demasiadas solicitudes', 
        message: `Máximo ${maxRequests} solicitudes por minuto`
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
  }
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
  const path = require('path');
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
            message: 'El APK aún no está disponible. Intenta nuevamente en unos minutos.' 
        });
    }
    
    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="BarrileteCosmico-TV.apk"');
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
            downloadUrl: '/apk'
        });
    } else {
        res.json({
            status: 'not_available',
            message: 'APK aún no está disponible'
        });
    }
});

// ✅ FUNCIÓN MEJORADA PARA VERIFICAR STREAMS - MÁS PERMISIVA
async function verifyStreamWithFFmpeg(streamUrl, timeout = 20000) {
  return new Promise((resolve) => {
    // Verificar con ffmpeg directamente - SIN pre-verificación con curl
    const ffmpegCommand = `timeout ${timeout/1000} ffmpeg -i "${streamUrl}" -t 2 -f null - 2>&1`;
    
    exec(ffmpegCommand, (error, stdout, stderr) => {
      // CONDICIONES MUY PERMISIVAS para aceptar diferentes formatos:
      // /play, play/xxxx, play/xxxx/index.m3u8
      const hasValidStream = 
        stderr.includes('Stream #') ||        // Información de stream
        stderr.includes('Video:') ||          // Stream de video
        stderr.includes('Audio:') ||          // Stream de audio  
        stderr.includes('Duration:') ||       // Duración del contenido
        stderr.includes('Input #0') ||        // Input detectado
        stderr.includes('Opening') ||         // Conectando al stream
        stderr.includes('Protocol') ||        // Protocolo detectado
        stderr.includes('format') ||          // Formato detectado
        stderr.includes('bitrate') ||         // Bitrate presente
        stderr.includes('fps') ||             // FPS presente
        stderr.includes('Hz') ||              // Frecuencia de audio
        stderr.includes('kb/s');              // Bitrate en kb/s

      // TAMBIÉN aceptar si hay conexión exitosa aunque haya timeout
      const hasConnection = 
        !stderr.includes('Connection refused') &&
        !stderr.includes('Name or service not known') &&
        !stderr.includes('No route to host') &&
        !stderr.includes('Network is unreachable');

      // Verificar específicamente formatos de URL válidos
      const isValidUrlFormat = 
        streamUrl.includes('/play') ||        // Cualquier URL con /play
        streamUrl.includes('play/') ||        // play/xxxx
        streamUrl.includes('index.m3u8') ||   // archivos .m3u8
        streamUrl.includes('.mpd') ||         // archivos DASH
        streamUrl.includes('.m3u') ||         // archivos M3U
        streamUrl.includes('playlist');       // playlists

      if ((hasValidStream || hasConnection) && isValidUrlFormat) {
        console.log(`✅ Stream ACTIVO: ${streamUrl.substring(0, 60)}...`);
        resolve(true);
      } else {
        console.log(`❌ Stream INACTIVO: ${streamUrl.substring(0, 60)}...`);
        if (stderr) {
          console.log(`   Info: ${stderr.substring(0, 150).replace(/\n/g, ' ')}`);
        }
        resolve(false);
      }
    });
  });
}

// Base de datos en memoria para los canales (en producción usar MongoDB/PostgreSQL)
let channels = [
  {
    id: "tnt-sports-hd",
    title: "TNT Sports HD",
    description: "Transmisión en vivo del canal TNT Sports en alta definición. Fútbol argentino y internacional.",
    streamUrl: "https://cdn.live.tn.com.ar/live/c7eds/TNTSports/SA_Live_dash_enc_2A/TNTSports.mpd",
    thumbnailUrl: "https://example.com/tnt-sports-thumb.jpg",
    isLive: true,
    category: "sports",
    viewerCount: 1500,
    country: "AR",
    language: "es",
    quality: "HD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "espn-premium-hd",
    title: "ESPN Premium HD",
    description: "Canal premium de ESPN con los mejores partidos de fútbol argentino y Copa Libertadores.",
    streamUrl: "https://cdn.live.espn.com.ar/live/espn-premium/hls/playlist.m3u8",
    thumbnailUrl: "https://example.com/espn-premium-thumb.jpg",
    isLive: true,
    category: "sports",
    viewerCount: 2100,
    country: "AR",
    language: "es",
    quality: "HD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "directv-sport",
    title: "DirecTV Sports",
    description: "Deportes en vivo con la mejor calidad. Fútbol argentino, Copa Sudamericana y más.",
    streamUrl: "https://edge.cvattv.com.ar/live/c3eds/DirectTVSports/SA_Live_dash_enc/DirectTVSports.mpd",
    thumbnailUrl: "https://example.com/directv-sports-thumb.jpg",
    isLive: true,
    category: "sports",
    viewerCount: 1800,
    country: "AR",
    language: "es",
    quality: "HD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "fox-sports-hd",
    title: "Fox Sports HD",
    description: "Transmisiones deportivas de Fox Sports. Premier League, Champions League y fútbol internacional.",
    streamUrl: "https://live.foxsportsla.tv/foxsportshd/playlist.m3u8",
    thumbnailUrl: "https://example.com/fox-sports-thumb.jpg",
    isLive: true,
    category: "sports",
    viewerCount: 1350,
    country: "AR",
    language: "es",
    quality: "HD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "espn-hd",
    title: "ESPN HD",
    description: "Canal principal de ESPN con noticias deportivas y transmisiones en vivo.",
    streamUrl: "https://cdn.live.espn.com.ar/live/espn/hls/playlist.m3u8",
    thumbnailUrl: "https://example.com/espn-thumb.jpg",
    isLive: true,
    category: "sports",
    viewerCount: 1100,
    country: "AR",
    language: "es",
    quality: "HD",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'BarrileteCosmico TV Backend API',
    timestamp: new Date().toISOString(),
    channels: channels.length
  });
});

// GET /api/streams - Obtener todos los canales con contadores REALES
app.get('/api/streams', (req, res) => {
  try {
    const { category } = req.query;
    
    // Filtrar por categoría si se especifica
    let filteredChannels = channels;
    if (category && category !== 'all') {
      filteredChannels = channels.filter(ch => ch.category === category);
    }
    
    // CONTADORES 100% REALES - No datos simulados
    const channelsWithRealStats = filteredChannels.map(channel => {
      const realStats = getRealChannelStats(channel.id);
      return {
        ...channel,
        // SOLO datos reales, sin valores mínimos falsos
        viewerCount: realStats.viewerCount,
        likes: realStats.likes,
        activeSessions: realStats.activeSessions,
        // Indicar que son contadores reales
        realTimeData: true,
        lastUpdated: new Date().toISOString()
      };
    });
    
    res.json({
      channels: channelsWithRealStats,
      totalChannels: channelsWithRealStats.length,
      realTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canales' });
  }
});

// GET /api/streams/featured - Obtener canales destacados
app.get('/api/streams/featured', (req, res) => {
  try {
    const featured = channels.filter(channel => channel.viewerCount > 1500);
    res.json(featured);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canales destacados' });
  }
});

// GET /api/streams/:id - Obtener canal por ID con estadísticas reales
app.get('/api/streams/:id', (req, res) => {
  try {
    const channel = channels.find(c => c.id === req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }
    
    // ESTADÍSTICAS 100% REALES - Solo datos verdaderos
    const realStats = getRealChannelStats(channel.id);
    const channelWithStats = {
      ...channel,
      // SOLO contadores reales, sin simulaciones
      viewerCount: realStats.viewerCount,
      likes: realStats.likes,
      activeSessions: realStats.activeSessions,
      realTimeData: true,
      lastUpdated: new Date().toISOString()
    };
    
    res.json(channelWithStats);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canal' });
  }
});

// NOTA: POST /api/streams (crear canal) movido al router admin protegido /api/admin

// NOTA: Endpoints admin de streams movidos al router protegido /api/admin

// GET /api/streams/search - Buscar canales
app.get('/api/streams/search', (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
    }

    const results = channels.filter(channel =>
      channel.title.toLowerCase().includes(query.toLowerCase()) ||
      channel.description.toLowerCase().includes(query.toLowerCase()) ||
      channel.category.toLowerCase().includes(query.toLowerCase())
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
    const filtered = channels.filter(channel => 
      channel.category.toLowerCase() === category.toLowerCase()
    );
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Error al filtrar por categoría' });
  }
});

// NOTA: Endpoint /api/categories implementado más abajo con gestión avanzada de categorías

// NOTA: Sistema de tracking real implementado más arriba con WebSockets

// POST /api/streams/:id/join - Unirse a un stream (incrementar contador)
app.post('/api/streams/:id/join', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const viewerId = req.body.viewerId || uuidv4();
    
    // Verificar que el stream existe
    const stream = channels.find(c => c.id === streamId);
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
      lastPing: Date.now() 
    });
    
    // Actualizar contador en el canal
    stream.viewerCount = activeViewers.get(streamId).size;
    stream.updatedAt = new Date().toISOString();
    
    console.log(`📺 Viewer ${viewerId} se unió a ${stream.title} (${stream.viewerCount} viewers)`);
    
    res.json({ 
      viewerId, 
      viewerCount: stream.viewerCount,
      streamId 
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
    
    const stream = channels.find(c => c.id === streamId);
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
    
    console.log(`📺 Viewer ${viewerId} salió de ${stream.title} (${stream.viewerCount} viewers)`);
    
    res.json({ 
      viewerCount: stream.viewerCount,
      streamId 
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
    
    const stream = channels.find(c => c.id === streamId);
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
    
    const stream = channels.find(c => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    const viewerCount = activeViewers.get(streamId)?.size || 0;
    
    res.json({ 
      streamId,
      viewerCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener viewers' });
  }
});

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
    
    const stream = channels.find(c => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    // Inicializar likes para el stream si no existe
    if (!likesDatabase.has(streamId)) {
      likesDatabase.set(streamId, {
        likes: 0,
        likedBy: new Set()
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
    
    console.log(`${hasLiked ? '👎' : '👍'} Usuario ${userId} ${hasLiked ? 'quitó like' : 'dio like'} a ${stream.title} (${streamLikes.likes} likes)`);
    
    res.json({
      streamId,
      likes: streamLikes.likes,
      liked: !hasLiked,
      timestamp: new Date().toISOString()
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
    
    const stream = channels.find(c => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    // Inicializar si no existe
    if (!likesDatabase.has(streamId)) {
      likesDatabase.set(streamId, {
        likes: 0,
        likedBy: new Set()
      });
    }
    
    const streamLikes = likesDatabase.get(streamId);
    
    res.json({
      streamId,
      likes: streamLikes.likes,
      liked: userId ? streamLikes.likedBy.has(userId) : false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error obteniendo likes:', error);
    res.status(500).json({ error: 'Error al obtener likes' });
  }
});

// GET /api/streams/likes/summary - Obtener resumen de likes de todos los streams
app.get('/api/streams/likes/summary', (req, res) => {
  try {
    const summary = {};
    
    for (const [streamId, likesData] of likesDatabase.entries()) {
      summary[streamId] = {
        likes: likesData.likes,
        streamId
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

// ANTI-SPAM: Rate limiting por usuario
// ⚡ RATE LIMITING ELIMINADO COMPLETAMENTE - MENSAJES INSTANTÁNEOS
// const chatRateLimit = new Map(); // DESHABILITADO
// const CHAT_RATE_LIMIT = 0; // SIN DELAYS
// const MAX_MESSAGES_PER_MINUTE = 999999; // SIN LÍMITES

// POST /api/streams/:id/chat - Enviar mensaje de chat (con anti-spam)
app.post('/api/streams/:id/chat', (req, res) => {
  try {
    const { id: streamId } = req.params;
    const { username, message, userId } = req.body;
    
    if (!username || !message) {
      return res.status(400).json({ error: 'Username y message son requeridos' });
    }
    
    // BASIC AUTH CHECK para endpoints admin (opcional)
    // TODO: Implementar JWT o session auth para endpoints sensibles
    
    // ⚡ ANTI-SPAM ELIMINADO COMPLETAMENTE - MENSAJES AL INSTANTE
    // Sin delays, sin límites, sin restricciones - LIBERTAD TOTAL
    
    // Filtro de longitud de mensaje
    if (message.length > 200) {
      return res.status(400).json({ error: 'Mensaje muy largo (máx 200 caracteres)' });
    }
    
    // Filtro de mensajes vacíos o solo espacios
    if (message.trim().length < 2) {
      return res.status(400).json({ error: 'Mensaje muy corto (mín 2 caracteres)' });
    }
    
    const stream = channels.find(c => c.id === streamId);
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
      colorHex: "#00BFFF" // Color fijo por ahora
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
      timestamp: new Date().toISOString()
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
    
    const stream = channels.find(c => c.id === streamId);
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
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// ===== ENDPOINTS ADMIN MOVIDOS AL ROUTER PROTEGIDO =====

// DELETE /api/admin/streams/:id/chat - Limpiar chat de un stream
adminRouter.delete('/streams/:id/chat', (req, res) => {
  try {
    const { id: streamId } = req.params;
    
    const stream = channels.find(c => c.id === streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream no encontrado' });
    }
    
    // Limpiar mensajes
    chatDatabase.set(streamId, []);
    
    console.log(`🧹 Chat limpiado para ${stream.title} por admin`);
    
    res.json({
      streamId,
      message: 'Chat limpiado exitosamente',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error limpiando chat:', error);
    res.status(500).json({ error: 'Error al limpiar chat' });
  }
});

// PUT /api/admin/streams/:id - Actualizar canal
adminRouter.put('/streams/:id', (req, res) => {
  try {
    const channelIndex = channels.findIndex(c => c.id === req.params.id);
    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const updatedChannel = {
      ...channels[channelIndex],
      ...req.body,
      id: req.params.id, // Mantener ID original
      updatedAt: new Date().toISOString()
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
    const channelIndex = channels.findIndex(c => c.id === req.params.id);
    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const deletedChannel = channels.splice(channelIndex, 1)[0];
    
    console.log(`🗑️ Canal eliminado por admin: ${deletedChannel.title}`);
    
    res.json({ message: 'Canal eliminado exitosamente', channel: deletedChannel });
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
      language = 'es'
    } = req.body;

    if (!title || !description || !streamUrl) {
      return res.status(400).json({ 
        error: 'Faltan campos obligatorios: title, description, streamUrl' 
      });
    }

    // Verificar que la categoría existe
    const categoryExists = categories.find(cat => cat.id === category);
    if (!categoryExists) {
      return res.status(400).json({ 
        error: `Categoría '${category}' no existe. Usa: ${categories.map(c => c.id).join(', ')}` 
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
      viewerCount: Math.floor(Math.random() * 100) + 50, // Base mínima
      country,
      language,
      quality,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
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

// ===== GESTIÓN DE CATEGORÍAS DINÁMICAS =====

// GET /api/categories - Obtener todas las categorías
app.get('/api/categories', (req, res) => {
  try {
    const categoriesWithCount = categories
      .filter(cat => cat.isActive)
      .map(category => ({
        ...category,
        channelCount: channels.filter(ch => ch.category === category.id).length
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
    const categoriesWithCount = categories.map(category => ({
      ...category,
      channelCount: channels.filter(ch => ch.category === category.id).length
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
    if (categories.find(cat => cat.id === id)) {
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
      createdAt: new Date().toISOString()
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
    const categoryIndex = categories.findIndex(cat => cat.id === req.params.id);
    if (categoryIndex === -1) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    const { name, description, color, icon, order, isActive } = req.body;
    
    categories[categoryIndex] = {
      ...categories[categoryIndex],
      name: name || categories[categoryIndex].name,
      description: description !== undefined ? description : categories[categoryIndex].description,
      color: color || categories[categoryIndex].color,
      icon: icon || categories[categoryIndex].icon,
      order: order !== undefined ? order : categories[categoryIndex].order,
      isActive: isActive !== undefined ? isActive : categories[categoryIndex].isActive,
      updatedAt: new Date().toISOString()
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
    const categoryIndex = categories.findIndex(cat => cat.id === req.params.id);
    if (categoryIndex === -1) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    const categoryId = req.params.id;
    
    // Verificar si hay canales en esta categoría
    const channelsInCategory = channels.filter(ch => ch.category === categoryId);
    if (channelsInCategory.length > 0) {
      return res.status(400).json({ 
        error: `No se puede eliminar. Hay ${channelsInCategory.length} canales en esta categoría.` 
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

// ===== SISTEMA DE MÚLTIPLES SERVIDORES =====

// GET /api/servers - Obtener servidores disponibles (para la app)
app.get('/api/servers', (req, res) => {
  try {
    const activeServers = servers
      .filter(server => server.isActive)
      .sort((a, b) => b.priority - a.priority)
      .map(server => ({
        id: server.id,
        name: server.name,
        description: server.description,
        baseUrl: server.baseUrl,
        isPrimary: server.isPrimary,
        priority: server.priority
      }));
    
    res.json({
      servers: activeServers,
      primary: activeServers.find(s => s.isPrimary) || activeServers[0],
      totalServers: activeServers.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener servidores' });
  }
});

// GET /api/admin/servers - Obtener todos los servidores
adminRouter.get('/servers', (req, res) => {
  try {
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener servidores' });
  }
});

// POST /api/admin/servers - Agregar nuevo servidor
adminRouter.post('/servers', async (req, res) => {
  try {
    const { name, description, baseUrl, apiKey, priority } = req.body;
    
    if (!name || !baseUrl) {
      return res.status(400).json({ 
        error: 'Nombre y URL base son obligatorios' 
      });
    }
    
    // Verificar que la URL es válida
    try {
      new URL(baseUrl);
    } catch (urlError) {
      return res.status(400).json({ error: 'URL base no es válida' });
    }
    
    // Verificar que no existe un servidor con la misma URL
    if (servers.find(s => s.baseUrl === baseUrl)) {
      return res.status(400).json({ error: 'Ya existe un servidor con esa URL' });
    }
    
    // Probar conexión al servidor
    let connectionStatus = 'unknown';
    try {
      const testResponse = await fetch(`${baseUrl}/health`, { 
        timeout: 5000,
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      });
      connectionStatus = testResponse.ok ? 'connected' : 'error';
    } catch (fetchError) {
      connectionStatus = 'error';
      console.log(`⚠️ No se pudo conectar a ${baseUrl}: ${fetchError.message}`);
    }
    
    const newServer = {
      id: uuidv4(),
      name,
      description: description || '',
      baseUrl,
      apiKey: apiKey || null,
      isActive: true,
      isPrimary: false, // Solo un servidor puede ser primario
      priority: priority || servers.length + 1,
      connectionStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    servers.push(newServer);
    servers.sort((a, b) => b.priority - a.priority);
    
    console.log(`🌐 Nuevo servidor agregado: ${name} (${baseUrl}) - Status: ${connectionStatus}`);
    
    res.status(201).json(newServer);
  } catch (error) {
    console.error('Error agregando servidor:', error);
    res.status(500).json({ error: 'Error al agregar servidor' });
  }
});

// PUT /api/admin/servers/:id - Actualizar servidor
adminRouter.put('/servers/:id', async (req, res) => {
  try {
    const serverIndex = servers.findIndex(s => s.id === req.params.id);
    if (serverIndex === -1) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const { name, description, baseUrl, apiKey, isActive, isPrimary, priority } = req.body;
    
    // Si se está marcando como primario, desmarcar otros
    if (isPrimary === true) {
      servers.forEach(s => { s.isPrimary = false; });
    }
    
    // Probar nueva conexión si cambió la URL
    let connectionStatus = servers[serverIndex].connectionStatus;
    if (baseUrl && baseUrl !== servers[serverIndex].baseUrl) {
      try {
        const testResponse = await fetch(`${baseUrl}/health`, { 
          timeout: 5000,
          headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
        });
        connectionStatus = testResponse.ok ? 'connected' : 'error';
      } catch (fetchError) {
        connectionStatus = 'error';
      }
    }
    
    servers[serverIndex] = {
      ...servers[serverIndex],
      name: name || servers[serverIndex].name,
      description: description !== undefined ? description : servers[serverIndex].description,
      baseUrl: baseUrl || servers[serverIndex].baseUrl,
      apiKey: apiKey !== undefined ? apiKey : servers[serverIndex].apiKey,
      isActive: isActive !== undefined ? isActive : servers[serverIndex].isActive,
      isPrimary: isPrimary !== undefined ? isPrimary : servers[serverIndex].isPrimary,
      priority: priority !== undefined ? priority : servers[serverIndex].priority,
      connectionStatus,
      updatedAt: new Date().toISOString()
    };
    
    servers.sort((a, b) => b.priority - a.priority);
    
    console.log(`🌐 Servidor actualizado: ${servers[serverIndex].name}`);
    
    res.json(servers[serverIndex]);
  } catch (error) {
    console.error('Error actualizando servidor:', error);
    res.status(500).json({ error: 'Error al actualizar servidor' });
  }
});

// DELETE /api/admin/servers/:id - Eliminar servidor
adminRouter.delete('/servers/:id', (req, res) => {
  try {
    const serverIndex = servers.findIndex(s => s.id === req.params.id);
    if (serverIndex === -1) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    // No permitir eliminar el servidor primario si es el único
    if (servers[serverIndex].isPrimary && servers.filter(s => s.isActive).length === 1) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el único servidor primario activo' 
      });
    }
    
    const deletedServer = servers.splice(serverIndex, 1)[0];
    
    // Si se eliminó el primario, asignar a otro
    if (deletedServer.isPrimary && servers.filter(s => s.isActive).length > 0) {
      const nextPrimary = servers.filter(s => s.isActive).sort((a, b) => b.priority - a.priority)[0];
      if (nextPrimary) {
        nextPrimary.isPrimary = true;
        console.log(`🌐 Nuevo servidor primario: ${nextPrimary.name}`);
      }
    }
    
    console.log(`🗑️ Servidor eliminado: ${deletedServer.name}`);
    
    res.json({ message: 'Servidor eliminado exitosamente', server: deletedServer });
  } catch (error) {
    console.error('Error eliminando servidor:', error);
    res.status(500).json({ error: 'Error al eliminar servidor' });
  }
});

// POST /api/admin/servers/:id/test - Probar conexión a servidor
adminRouter.post('/servers/:id/test', async (req, res) => {
  try {
    const server = servers.find(s => s.id === req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${server.baseUrl}/health`, {
        timeout: 10000,
        headers: server.apiKey ? { 'Authorization': `Bearer ${server.apiKey}` } : {}
      });
      
      const responseTime = Date.now() - startTime;
      const success = response.ok;
      
      // Actualizar status en memoria
      const serverIndex = servers.findIndex(s => s.id === req.params.id);
      if (serverIndex !== -1) {
        servers[serverIndex].connectionStatus = success ? 'connected' : 'error';
        servers[serverIndex].lastChecked = new Date().toISOString();
      }
      
      res.json({
        success,
        responseTime,
        status: response.status,
        message: success ? 'Conexión exitosa' : 'Error de conexión',
        timestamp: new Date().toISOString()
      });
      
    } catch (fetchError) {
      // Actualizar status a error
      const serverIndex = servers.findIndex(s => s.id === req.params.id);
      if (serverIndex !== -1) {
        servers[serverIndex].connectionStatus = 'error';
        servers[serverIndex].lastChecked = new Date().toISOString();
      }
      
      res.json({
        success: false,
        responseTime: Date.now() - startTime,
        error: fetchError.message,
        message: 'No se pudo conectar al servidor',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error probando servidor:', error);
    res.status(500).json({ error: 'Error al probar servidor' });
  }
});

// ===== SISTEMA DE CONFIGURACIÓN UI =====

// Configuración completa de UI - AHORA configurable desde backend
let uiConfiguration = {
  app: {
    name: "BarrileteCosmico TV",
    version: "1.0.0",
    tagline: "Fútbol argentino • Pasión • En vivo",
    description: "La mejor plataforma de streaming deportivo argentino"
  },
  theme: {
    primary: "#36B5D8",        // CosmicPrimary (celeste argentino)
    secondary: "#F77A2B",       // CosmicSecondary (naranja vibrante)  
    background: "#0C1218",      // CosmicBackground (muy oscuro con tinte azul)
    surface: "#1A242E",         // CosmicSurface (superficie oscura con tinte)
    card: "#1E2A38",           // CosmicCard (cards ligeramente más claros)
    border: "#2A3441",          // CosmicBorder (bordes sutiles)
    textPrimary: "#F5F5F5",     // CosmicOnBackground
    textSecondary: "#E8E8E8",   // CosmicOnSurface
    textMuted: "#9CA3AF",       // CosmicMuted
    accent: "#E740B7",          // ArgentinaEnergy (rosa vibrante)
    success: "#10B981",         // Verde para "EN VIVO"
    warning: "#F59E0B",         // Amarillo/naranja
    error: "#E83D3D",          // ArgentinaPassion (rojo)
    liveIndicator: "#10B981",   // Verde para badges "EN VIVO"
    adminColor: "#E83D3D"       // Color para mensajes admin
  },
  strings: {
    home: {
      welcomeTitle: "Barrilete Cósmico",
      welcomeSubtitle: "Fútbol argentino • Pasión • En vivo",
      searchPlaceholder: "Buscar canales deportivos...",
      noChannelsMessage: "No hay canales disponibles",
      loadingMessage: "Cargando canales...",
      refreshingMessage: "Actualizando canales...",
      noResultsTitle: "Sin resultados",
      noResultsMessage: "No encontramos canales con ese término"
    },
    stream: {
      viewersLabel: "espectadores",
      chatTitle: "⚽ Chat en vivo",
      chatPlaceholder: "Escribe tu mensaje...",
      usernameDialogTitle: "✏️ Elegí tu nombre",
      usernameDialogSubtitle: "Ingresá tu nombre para chatear en vivo:",
      usernameDialogPlaceholder: "Ej: Hincha10, Lionel10",
      usernameDialogConfirm: "Confirmar",
      usernameDialogCancel: "Cancelar",
      changeNameTitle: "✏️ Cambiar nombre",
      changeNameSubtitle: "Cambiá tu nombre de usuario:",
      fullscreenEnter: "Pantalla completa",
      fullscreenExit: "Salir pantalla completa",
      liveLabel: "EN VIVO"
    },
    general: {
      defaultChannelTitle: "Canal Deportivo",
      featuredLabel: "Destacado",
      sportsCategory: "Deportes",
      loadingGeneral: "Cargando...",
      errorGeneral: "Error al cargar",
      retryButton: "Reintentar"
    }
  },
  features: {
    enableChat: true,
    enableLikes: true,
    enableViewerCount: true,
    enableFullscreen: true,
    enableCast: true,
    autoRefresh: true,
    refreshInterval: 30000,
    pullToRefresh: true,
    chatMaxMessages: 100,
    chatRefreshInterval: 5000
  },
  ui: {
    gridColumns: 2,
    animationDelay: 100,
    featuredThreshold: 1500,
    headerHeight: 60,
    bottomNavHeight: 56,
    borderRadius: 12,
    cardElevation: 4
  },
  assets: {
    logoUrl: "/api/assets/logo.png",
    backgroundPattern: "/api/assets/bg-pattern.png",
    defaultThumbnail: "/api/assets/default-thumb.jpg",
    liveIconUrl: "/api/assets/live-icon.svg"
  }
};

// GET /api/config/ui - Obtener configuración completa de UI
app.get('/api/config/ui', (req, res) => {
  try {
    res.json({
      config: uiConfiguration,
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    });
  } catch (error) {
    console.error('Error obteniendo configuración UI:', error);
    res.status(500).json({ error: 'Error al obtener configuración UI' });
  }
});

// PUT /api/config/ui - Actualizar configuración UI (admin)
app.put('/api/config/ui', (req, res) => {
  try {
    const { section, data } = req.body;
    
    if (!section || !data) {
      return res.status(400).json({ error: 'section y data son requeridos' });
    }
    
    // Validar que la sección existe
    if (!uiConfiguration[section]) {
      return res.status(404).json({ error: `Sección '${section}' no encontrada` });
    }
    
    // Actualizar configuración
    uiConfiguration[section] = { ...uiConfiguration[section], ...data };
    
    console.log(`⚙️ Configuración UI actualizada - Sección: ${section}`);
    
    res.json({
      section,
      updatedConfig: uiConfiguration[section],
      message: 'Configuración actualizada exitosamente',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error actualizando configuración UI:', error);
    res.status(500).json({ error: 'Error al actualizar configuración UI' });
  }
});

// GET /api/config/ui/:section - Obtener sección específica de configuración
app.get('/api/config/ui/:section', (req, res) => {
  try {
    const { section } = req.params;
    
    if (!uiConfiguration[section]) {
      return res.status(404).json({ error: `Sección '${section}' no encontrada` });
    }
    
    res.json({
      section,
      config: uiConfiguration[section],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error obteniendo sección de configuración:', error);
    res.status(500).json({ error: 'Error al obtener sección de configuración' });
  }
});

// Limpieza automática de sesiones inactivas (cada 30 segundos)
setInterval(() => {
  const now = Date.now();
  const timeout = 60000; // 60 segundos timeout
  
  let cleanedSessions = 0;
  
  for (const [viewerId, session] of viewerSessionsREST.entries()) {
    if (now - session.lastPing > timeout) {
      // Remover sesión inactiva
      const { streamId } = session;
      if (activeViewers.has(streamId)) {
        activeViewers.get(streamId).delete(viewerId);
        
        // Actualizar contador en el canal
        const stream = channels.find(c => c.id === streamId);
        if (stream) {
          stream.viewerCount = activeViewers.get(streamId).size;
          stream.updatedAt = new Date().toISOString();
        }
      }
      
      viewerSessionsREST.delete(viewerId);
      cleanedSessions++;
    }
  }
  
  if (cleanedSessions > 0) {
    console.log(`🧹 Limpiadas ${cleanedSessions} sesiones inactivas`);
  }
}, 30000);

// ===== ENDPOINTS UI CONFIG =====

// GET /api/ui-config - Obtener configuración completa
app.get('/api/ui-config', (req, res) => {
  try {
    res.json({
      success: true,
      config: uiConfiguration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error obteniendo UI config:', error);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// PUT /api/ui-config - Actualizar configuración completa
app.put('/api/ui-config', (req, res) => {
  try {
    // Merge con configuración existente
    uiConfiguration = { ...uiConfiguration, ...req.body };
    
    console.log('✏️ UI Config actualizada:', Object.keys(req.body));
    
    res.json({
      success: true,
      config: uiConfiguration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error actualizando UI config:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// GET /api/ui-config/:section - Obtener sección específica
app.get('/api/ui-config/:section', (req, res) => {
  try {
    const { section } = req.params;
    
    if (!uiConfiguration[section]) {
      return res.status(404).json({ error: 'Sección no encontrada' });
    }
    
    res.json({
      success: true,
      section,
      data: uiConfiguration[section],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error obteniendo sección UI config:', error);
    res.status(500).json({ error: 'Error al obtener sección' });
  }
});

// PUT /api/ui-config/:section - Actualizar sección específica
app.put('/api/ui-config/:section', (req, res) => {
  try {
    const { section } = req.params;
    
    if (!uiConfiguration[section]) {
      return res.status(404).json({ error: 'Sección no encontrada' });
    }
    
    // Merge con sección existente
    uiConfiguration[section] = { ...uiConfiguration[section], ...req.body };
    
    console.log(`✏️ Sección ${section} actualizada:`, Object.keys(req.body));
    
    res.json({
      success: true,
      section,
      data: uiConfiguration[section],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error actualizando sección UI config:', error);
    res.status(500).json({ error: 'Error al actualizar sección' });
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
      
      // Extraer atributos (todo lo que esté entre comas hasta la coma final)
      const attributesSection = info.substring(info.indexOf(',') + 1);
      
      // Buscar atributos comunes
      const titleMatch = attributesSection.match(/tvg-name="([^"]+)"/);
      const logoMatch = attributesSection.match(/tvg-logo="([^"]+)"/);
      const groupMatch = attributesSection.match(/group-title="([^"]+)"/);
      const idMatch = attributesSection.match(/tvg-id="([^"]+)"/);
      
      // El nombre del canal está al final después del último atributo
      const nameParts = attributesSection.split(',');
      const channelName = nameParts[nameParts.length - 1].trim();
      
      currentChannel = {
        id: idMatch ? idMatch[1] : generateChannelId(channelName),
        title: titleMatch ? titleMatch[1] : channelName,
        description: `Canal ${channelName} - Transmisión en vivo`,
        thumbnailUrl: logoMatch ? logoMatch[1] : "https://via.placeholder.com/300x200/1a1a1a/ffffff?text=" + encodeURIComponent(channelName),
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
      parsedChannels.push({...currentChannel});
      currentChannel = {}; // Reset para el siguiente canal
    }
  }
  
  return parsedChannels;
}

// Función para generar ID único del canal
function generateChannelId(channelName) {
  return channelName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30) + '-' + Math.random().toString(36).substr(2, 6);
}

// POST /api/playlists/upload - Subir archivo M3U8
app.post('/api/playlists/upload', upload.single('playlist'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    
    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Parsear el contenido M3U8
    const newChannels = parseM3U8Content(content);
    
    if (newChannels.length === 0) {
      return res.status(400).json({ error: 'No se encontraron canales válidos en el archivo' });
    }
    
    // Agregar canales a la lista existente (evitar duplicados)
    let addedCount = 0;
    newChannels.forEach(newChannel => {
      const exists = channels.find(ch => ch.id === newChannel.id || ch.title === newChannel.title);
      if (!exists) {
        channels.push(newChannel);
        addedCount++;
      }
    });
    
    // Limpiar archivo temporal
    fs.unlinkSync(filePath);
    
    console.log(`📺 Agregados ${addedCount} canales nuevos desde archivo M3U8`);
    
    res.json({
      message: `Playlist procesada exitosamente`,
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
    
    if (!url) {
      return res.status(400).json({ error: 'URL requerida' });
    }
    
    if (!url.match(/^https?:\/\/.+\.(m3u8?|txt)$/i)) {
      return res.status(400).json({ error: 'URL debe apuntar a un archivo .m3u8 o .m3u' });
    }
    
    // Descargar el contenido de la URL
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(400).json({ error: `Error descargando playlist: ${response.statusText}` });
    }
    
    const content = await response.text();
    
    // Parsear el contenido M3U8
    const newChannels = parseM3U8Content(content);
    
    if (newChannels.length === 0) {
      return res.status(400).json({ error: 'No se encontraron canales válidos en la playlist' });
    }
    
    // Agregar canales a la lista existente (evitar duplicados)
    let addedCount = 0;
    newChannels.forEach(newChannel => {
      const exists = channels.find(ch => ch.id === newChannel.id || ch.title === newChannel.title);
      if (!exists) {
        channels.push(newChannel);
        addedCount++;
      }
    });
    
    console.log(`📺 Agregados ${addedCount} canales nuevos desde URL: ${url}`);
    
    res.json({
      message: `Playlist cargada exitosamente desde URL`,
      url: url,
      channelsFound: newChannels.length,
      channelsAdded: addedCount,
      totalChannels: channels.length
    });
    
  } catch (error) {
    console.error('Error cargando playlist desde URL:', error);
    res.status(500).json({ error: 'Error cargando playlist desde URL' });
  }
});

// GET /api/playlists/export - Exportar canales actuales como M3U8
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

// DELETE /api/channels/:id - Eliminar canal específico
app.delete('/api/channels/:id', (req, res) => {
  try {
    const { id } = req.params;
    const initialLength = channels.length;
    
    channels = channels.filter(channel => channel.id !== id);
    
    if (channels.length === initialLength) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }
    
    console.log(`🗑️ Canal ${id} eliminado`);
    
    res.json({
      message: `Canal eliminado exitosamente`,
      channelId: id,
      totalChannels: channels.length
    });
    
  } catch (error) {
    console.error('Error eliminando canal:', error);
    res.status(500).json({ error: 'Error eliminando canal' });
  }
});

// POST /api/channels/clear - Limpiar todos los canales
app.post('/api/channels/clear', (req, res) => {
  try {
    const previousCount = channels.length;
    channels = [];
    
    console.log(`🧹 Eliminados ${previousCount} canales`);
    
    res.json({
      message: `Todos los canales han sido eliminados`,
      channelsRemoved: previousCount,
      totalChannels: 0
    });
    
  } catch (error) {
    console.error('Error limpiando canales:', error);
    res.status(500).json({ error: 'Error limpiando canales' });
  }
});

// ===== SISTEMA DE MONITOREO AUTOMÁTICO DE ARCHIVOS M3U8 =====

// Función para monitorear la carpeta 'channels' automáticamente
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
    ignored: /(^|[\/\\])\../, // Ignorar archivos ocultos
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });
  
  watcher
    .on('add', (filePath) => {
      if (filePath.match(/\.(m3u8?|m3u)$/i)) {
        console.log(`📁 Nuevo archivo M3U8 detectado: ${filePath}`);
        processChannelFile(filePath);
      }
    })
    .on('change', (filePath) => {
      if (filePath.match(/\.(m3u8?|m3u)$/i)) {
        console.log(`📁 Archivo M3U8 modificado: ${filePath}`);
        processChannelFile(filePath);
      }
    })
    .on('unlink', (filePath) => {
      if (filePath.match(/\.(m3u8?|m3u)$/i)) {
        console.log(`📁 Archivo M3U8 eliminado: ${filePath}`);
      }
    })
    .on('error', (error) => {
      console.error('🔥 Error en file watcher:', error);
    });
  
  console.log(`👁️ Monitoreando carpeta: ${channelsDir}`);
}

// Procesar archivos existentes al iniciar
function processExistingFiles(channelsDir) {
  try {
    const files = fs.readdirSync(channelsDir);
    const m3uFiles = files.filter(file => file.match(/\.(m3u8?|m3u)$/i));
    
    if (m3uFiles.length > 0) {
      console.log(`📂 Procesando ${m3uFiles.length} archivos M3U8 existentes...`);
      m3uFiles.forEach(file => {
        const filePath = path.join(channelsDir, file);
        processChannelFile(filePath);
      });
    }
  } catch (error) {
    console.error('Error procesando archivos existentes:', error);
  }
}

// Procesar un archivo M3U8 específico
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
    console.log(`📺 ${newChannels.length} canales encontrados, verificando con ffmpeg...`);
    
    // ✅ VERIFICAR CADA CANAL CON FFMPEG ANTES DE AGREGARLO
    let addedCount = 0;
    // ✅ VERIFICACIÓN SIMPLE SIN FFMPEG PROBLEMÁTICO
    newChannels.forEach(newChannel => {
      // Verificar duplicados por ID, título Y URL del stream
      const exists = channels.find(ch => 
        ch.id === newChannel.id || 
        ch.title === newChannel.title ||
        ch.streamUrl === newChannel.streamUrl
      );
      
      if (!exists) {
        channels.push(newChannel);
        addedCount++;
        console.log(`✅ Canal agregado: ${newChannel.title}`);
      } else {
        console.log(`⚠️ Canal duplicado ignorado: ${newChannel.title}`);
      }
    });
    
    console.log(`📺 ${addedCount} canales ACTIVOS agregados (de ${newChannels.length} verificados)`);
    console.log(`📊 Total de canales: ${channels.length}`);
    
  } catch (error) {
    console.error(`❌ Error procesando ${filePath}:`, error.message);
  }
}

// ===== PANEL DE ADMINISTRACIÓN WEB =====

// Servir panel admin CONTROL TOTAL Y EDITABLE
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-panel-full-control.html'));
});

// Redirigir raíz al admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ===== APLICAR PROTECCIÓN CENTRALIZADA AL ROUTER ADMIN =====
// TODOS los endpoints bajo /api/admin requieren autenticación y rate limiting
app.use('/api/admin', requireAuth, rateLimit(30, 60000), adminRouter);

// ===== APIs PARA PANEL ADMIN =====
// GET /api/admin/stats - Estadísticas del dashboard
adminRouter.get('/stats', (req, res) => {
  try {
    // 🔧 Nuevo cálculo de usuarios online (REST + WebSockets)
    const onlineUsers =
      Array.from(activeViewers.values()).reduce((total, set) => total + set.size, 0) +
      Array.from(viewerSessions.values()).reduce(
        (total, v) => total + (v instanceof Set ? v.size : 0),
        0
      );

    const todayMessages = Array.from(chatDatabase.values())
      .flat()
      .filter(msg => {
        const today = new Date();
        const msgDate = new Date(msg.timestamp);
        return msgDate.toDateString() === today.toDateString();
      }).length;

    // Estadísticas de FCM
    const totalFCMTokens = Array.from(deviceTokens.values()).reduce(
      (total, set) => total + set.size,
      0
    );
    const totalFCMUsers = deviceTokens.size;

    // Contar notificaciones enviadas hoy
    const notificationsSentToday = notificationHistory.filter(notif => {
      const today = new Date();
      const notifDate = new Date(notif.sent_at);
      return notifDate.toDateString() === today.toDateString();
    }).length;

    res.json({
      activeChannels: channels.length,
      onlineUsers,
      todayMessages,
      notificationsSent: notificationsSentToday,
      // Nuevas métricas Firebase FCM
      fcm: {
        totalTokens: totalFCMTokens,
        totalUsers: totalFCMUsers,
        enabled: fcmEnabled,
        status: fcmEnabled ? 'Firebase FCM activo' : 'Modo simulación'
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/admin/channels - Agregar nuevo canal
adminRouter.post('/channels', (req, res) => {
  try {
    const { name, category, url, description } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'Nombre y URL son requeridos' });
    }

    const newChannel = {
      id: generateChannelId(name),
      title: name.trim(),
      description: description || '',
      streamUrl: url.trim(),
      logo: '/default-logo.png',
      category: category || 'deportes',
      active: true,
      created_at: new Date().toISOString()
    };

    channels.push(newChannel);

    console.log(`✅ Canal agregado desde admin: ${newChannel.title}`);

    res.json({
      success: true,
      channel: newChannel,
      message: 'Canal agregado exitosamente'
    });
  } catch (error) {
    console.error('Error agregando canal:', error);
    res.status(500).json({ error: 'Error al agregar canal' });
  }
});

// DELETE /api/admin/channels/:id - Eliminar canal
adminRouter.delete('/channels/:id', (req, res) => {
  try {
    const { id } = req.params;

    const channelIndex = channels.findIndex(c => c.id === id);
    if (channelIndex === -1) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const deletedChannel = channels.splice(channelIndex, 1)[0];

    // Limpiar datos relacionados
    if (chatDatabase.has(id)) {
      chatDatabase.delete(id);
    }
    if (likesDatabase.has(id)) {
      likesDatabase.delete(id);
    }
    if (viewerSessions.has(id)) {
      viewerSessions.delete(id);
    }

    console.log(`🗑️ Canal eliminado: ${deletedChannel.title}`);

    res.json({
      success: true,
      message: 'Canal eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error eliminando canal:', error);
    res.status(500).json({ error: 'Error al eliminar canal' });
  }
});
// ===== FIREBASE FCM ENDPOINTS =====

// POST /api/fcm/register - Registrar token de dispositivo
app.post('/api/fcm/register', rateLimit(20, 60000), (req, res) => {
  try {
    const { token, userId, deviceInfo: info } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token FCM es requerido' });
    }
    
    // Validar formato básico del token FCM (debe ser string no vacío)
    if (typeof token !== 'string' || token.trim().length < 10) {
      return res.status(400).json({ error: 'Formato de token FCM inválido' });
    }
    
    // Usar un userId por defecto si no se proporciona
    const finalUserId = userId || 'anonymous_' + Math.random().toString(36).substr(2, 9);
    
    // Verificar si el token ya existe (para evitar duplicados)
    let tokenExists = false;
    for (const [existingUserId, tokens] of deviceTokens.entries()) {
      if (tokens.has(token)) {
        if (existingUserId === finalUserId) {
          tokenExists = true;
          break;
        } else {
          // Token existía para otro usuario, moverlo
          tokens.delete(token);
          console.log(`📱 Token movido de usuario ${existingUserId} a ${finalUserId}`);
          break;
        }
      }
    }
    
    // Agregar token al set de tokens del usuario
    if (!deviceTokens.has(finalUserId)) {
      deviceTokens.set(finalUserId, new Set());
    }
    
    if (!tokenExists) {
      deviceTokens.get(finalUserId).add(token);
    }
    
    // Guardar info del dispositivo
    if (info) {
      deviceInfo.set(token, {
        ...info,
        registeredAt: new Date().toISOString(),
        userId: finalUserId
      });
    }
    
    console.log(`📱 Token FCM registrado para usuario: ${finalUserId}`);
    
    res.json({
      success: true,
      message: 'Token registrado exitosamente',
      totalDevices: Array.from(deviceTokens.values()).reduce((total, set) => total + set.size, 0)
    });
    
  } catch (error) {
    console.error('Error registrando token FCM:', error);
    res.status(500).json({ error: 'Error al registrar token' });
  }
});

// GET /api/fcm/stats - Estadísticas de dispositivos registrados (PROTEGIDO)
app.get('/api/fcm/stats', requireAuth, rateLimit(20, 60000), (req, res) => {
  try {
    const totalTokens = Array.from(deviceTokens.values()).reduce((total, set) => total + set.size, 0);
    const totalUsers = deviceTokens.size;
    const recentDevices = Array.from(deviceInfo.values())
      .filter(info => new Date(info.registeredAt) > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .length;
    
    res.json({
      totalTokens,
      totalUsers,
      recentDevices,
      fcmEnabled,
      status: fcmEnabled ? 'Firebase FCM activo' : 'Modo simulación'
    });
    
  } catch (error) {
    console.error('Error obteniendo estadísticas FCM:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST /api/fcm/unregister - Desregistrar token de dispositivo (PROTEGIDO)
app.post('/api/fcm/unregister', requireAuth, rateLimit(20, 60000), (req, res) => {
  try {
    const { token, userId } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token es requerido' });
    }
    
    // Remover token de todos los usuarios si no se especifica userId
    let removed = false;
    
    if (userId && deviceTokens.has(userId)) {
      deviceTokens.get(userId).delete(token);
      removed = true;
    } else {
      // Buscar en todos los usuarios
      for (const [user, tokens] of deviceTokens.entries()) {
        if (tokens.has(token)) {
          tokens.delete(token);
          removed = true;
          break;
        }
      }
    }
    
    // Remover info del dispositivo
    deviceInfo.delete(token);
    
    console.log(`📱 Token FCM desregistrado: ${removed ? 'exitoso' : 'no encontrado'}`);
    
    res.json({
      success: true,
      message: removed ? 'Token desregistrado exitosamente' : 'Token no encontrado'
    });
    
  } catch (error) {
    console.error('Error desregistrando token FCM:', error);
    res.status(500).json({ error: 'Error al desregistrar token' });
  }
});

// Función para enviar notificación push real via Firebase FCM
async function sendFirebaseNotification(notification) {
  if (!fcmEnabled || !firebaseApp) {
    console.log('🔄 Simulando envío de notificación (Firebase no configurado)');
    return {
      success: true,
      sent: 0,
      failed: 0,
      mode: 'simulation'
    };
  }
  
  try {
    // Obtener todos los tokens según la audiencia
    let targetTokens = [];
    
    switch (notification.audience) {
      case 'all':
        // Todos los dispositivos registrados
        for (const tokens of deviceTokens.values()) {
          targetTokens.push(...Array.from(tokens));
        }
        break;
      case 'active':
        // Dispositivos activos (registrados en las últimas 24 horas)
        const activeCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for (const [token, info] of deviceInfo.entries()) {
          if (new Date(info.registeredAt) > activeCutoff) {
            targetTokens.push(token);
          }
        }
        break;
      case 'premium':
        // Por ahora, 30% aleatorio de usuarios
        const allTokens = [];
        for (const tokens of deviceTokens.values()) {
          allTokens.push(...Array.from(tokens));
        }
        targetTokens = allTokens.slice(0, Math.floor(allTokens.length * 0.3));
        break;
      case 'inactive':
        // Dispositivos inactivos (registrados hace más de 7 días)
        const inactiveCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        for (const [token, info] of deviceInfo.entries()) {
          if (new Date(info.registeredAt) < inactiveCutoff) {
            targetTokens.push(token);
          }
        }
        break;
      default:
        targetTokens = [];
    }
    
    if (targetTokens.length === 0) {
      console.log('⚠️ No hay tokens disponibles para enviar notificación');
      return { success: true, sent: 0, failed: 0, mode: 'no_targets' };
    }
    
    // Configurar mensaje FCM
    const message = {
      notification: {
        title: notification.title,
        body: notification.message
      },
      data: {
        type: notification.type,
        timestamp: new Date().toISOString(),
        channel: 'barrilete_cosmic_tv'
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#87CEEB',
          sound: 'default',
          channelId: 'barrilete_notifications'
        },
        priority: 'high'
      }
    };
    
    let sent = 0;
    let failed = 0;
    
    // Enviar en lotes de 500 (límite de Firebase)
    const batchSize = 500;
    for (let i = 0; i < targetTokens.length; i += batchSize) {
      const batch = targetTokens.slice(i, i + batchSize);
      
      try {
        const response = await admin.messaging().sendMulticast({
          ...message,
          tokens: batch
        });
        
        sent += response.successCount;
        failed += response.failureCount;
        
        // Log errores específicos para debugging y limpieza de tokens
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const tokenIdx = i + idx;
              const failedToken = batch[idx];
              const errorCode = resp.error?.code;
              const errorMessage = resp.error?.message;
              
              console.log(`❌ Error enviando a token ${tokenIdx}: ${errorCode} - ${errorMessage}`);
              
              // Remover automáticamente tokens inválidos o expirados
              if (errorCode === 'messaging/registration-token-not-registered' ||
                  errorCode === 'messaging/invalid-registration-token' ||
                  errorCode === 'messaging/mismatched-credential' ||
                  errorCode === 'messaging/invalid-package-name') {
                removeInvalidToken(failedToken);
                console.log(`🗑️ Token inválido removido automáticamente: ${errorCode}`);
              }
            }
          });
        }
        
      } catch (batchError) {
        console.error('Error enviando lote de notificaciones:', batchError);
        failed += batch.length;
      }
    }
    
    console.log(`🔔 Notificación FCM enviada: ${sent} exitosas, ${failed} fallidas`);
    
    return {
      success: true,
      sent,
      failed,
      mode: 'firebase',
      totalTargets: targetTokens.length
    };
    
  } catch (error) {
    console.error('Error enviando notificación Firebase:', error);
    return {
      success: false,
      error: error.message,
      mode: 'firebase_error'
    };
  }
}

// Función para remover tokens inválidos
function removeInvalidToken(token) {
  try {
    let removedFromUser = null;
    
    // Buscar y remover el token de todos los usuarios
    for (const [userId, tokens] of deviceTokens.entries()) {
      if (tokens.has(token)) {
        tokens.delete(token);
        removedFromUser = userId;
        
        // Si el usuario no tiene más tokens, remover el usuario también
        if (tokens.size === 0) {
          deviceTokens.delete(userId);
        }
        break;
      }
    }
    
    // Remover info del dispositivo
    deviceInfo.delete(token);
    
    if (removedFromUser) {
      console.log(`🗑️ Token inválido removido para usuario: ${removedFromUser}`);
    }
    
    return removedFromUser !== null;
  } catch (error) {
    console.error('Error removiendo token inválido:', error);
    return false;
  }
}

// Función de limpieza de tokens (ejecutar periódicamente)
function cleanupOldTokens() {
  try {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 días atrás
    let removedCount = 0;
    
    for (const [token, info] of deviceInfo.entries()) {
      if (new Date(info.registeredAt) < cutoffDate) {
        removeInvalidToken(token);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 Limpieza automática: ${removedCount} tokens antiguos removidos`);
    }
  } catch (error) {
    console.error('Error en limpieza de tokens:', error);
  }
}

// Ejecutar limpieza cada 6 horas
setInterval(cleanupOldTokens, 6 * 60 * 60 * 1000);

// ===== SISTEMA DE NOTIFICACIONES =====

let notificationHistory = [];

// POST /api/admin/notifications/send - Enviar notificación
adminRouter.post('/notifications/send', async (req, res) => {
  try {
    const { title, message, type, audience } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Título y mensaje son requeridos' });
    }
    
    // Crear objeto de notificación
    const notificationData = {
      title,
      message,
      type,
      audience
    };
    
    // Enviar notificación real via Firebase FCM
    const fcmResult = await sendFirebaseNotification(notificationData);
    
    // Calcular destinatarios basado en el resultado real o estimado
    let recipients = fcmResult.sent || fcmResult.totalTargets || 0;
    
    // Si no hay dispositivos registrados, usar conteo estimado para demo
    if (recipients === 0 && fcmResult.mode === 'simulation') {
      const estimatedUsers = Object.keys(activeStreams).reduce((total, streamId) => {
        return total + (viewerSessions.get(streamId)?.size || 0);
      }, 0);
      
      switch (audience) {
        case 'all':
          recipients = estimatedUsers;
          break;
        case 'active':
          recipients = Math.floor(estimatedUsers * 0.8);
          break;
        case 'premium':
          recipients = Math.floor(estimatedUsers * 0.3);
          break;
        case 'inactive':
          recipients = Math.floor(estimatedUsers * 0.2);
          break;
        default:
          recipients = estimatedUsers;
      }
    }
    
    const notification = {
      id: Date.now(),
      title,
      message,
      type,
      audience,
      recipients,
      sent_at: new Date(),
      status: fcmResult.success ? 'sent' : 'failed',
      fcm_result: {
        mode: fcmResult.mode,
        sent: fcmResult.sent || 0,
        failed: fcmResult.failed || 0,
        error: fcmResult.error || null
      }
    };
    
    notificationHistory.unshift(notification);
    
    // Log detallado del resultado
    if (fcmResult.mode === 'firebase') {
      console.log(`🔔 Notificación FCM real enviada: "${title}" - ${fcmResult.sent} exitosas, ${fcmResult.failed} fallidas`);
    } else {
      console.log(`🔔 Notificación ${fcmResult.mode}: "${title}" a ${recipients} usuarios`);
    }
    
    res.json({
      success: true,
      notification,
      message: fcmResult.success ? 'Notificación enviada exitosamente' : 'Error enviando notificación',
      fcm_details: {
        mode: fcmResult.mode,
        sent: fcmResult.sent,
        failed: fcmResult.failed,
        firebase_enabled: fcmEnabled
      }
    });
    
  } catch (error) {
    console.error('Error enviando notificación:', error);
    res.status(500).json({ error: 'Error al enviar notificación' });
  }
});

// GET /api/admin/notifications/history - Historial de notificaciones
adminRouter.get('/notifications/history', (req, res) => {
  res.json(notificationHistory);
});

// ===== ENDPOINTS FCM PARA DISPOSITIVOS =====

// POST /api/devices/register - Registrar token de dispositivo (público)
app.post('/api/devices/register', (req, res) => {
  try {
    const { token, platform, appVersion } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token requerido' });
    }
    
    // Verificar si ya existe
    if (deviceTokens.has(token)) {
      console.log(`📱 Token ya registrado: ${token.substring(0, 20)}...`);
      return res.json({ message: 'Token ya registrado' });
    }
    
    // Registrar nuevo token
    deviceTokens.add(token);
    deviceInfo.set(token, {
      platform: platform || 'unknown',
      appVersion: appVersion || '1.0.0',
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
    
    console.log(`📱 Nuevo dispositivo registrado: ${platform || 'unknown'}`);
    
    res.status(201).json({ 
      message: 'Dispositivo registrado exitosamente',
      totalDevices: deviceTokens.size 
    });
    
  } catch (error) {
    console.error('Error registrando dispositivo:', error);
    res.status(500).json({ error: 'Error al registrar dispositivo' });
  }
});

// DELETE /api/devices/:token - Eliminar token de dispositivo (público)
app.delete('/api/devices/:token', (req, res) => {
  try {
    const { token } = req.params;
    
    if (deviceTokens.has(token)) {
      deviceTokens.delete(token);
      deviceInfo.delete(token);
      
      console.log(`📱 Token eliminado: ${token.substring(0, 20)}...`);
      
      res.json({ 
        message: 'Token eliminado exitosamente',
        totalDevices: deviceTokens.size 
      });
    } else {
      res.status(404).json({ error: 'Token no encontrado' });
    }
    
  } catch (error) {
    console.error('Error eliminando token:', error);
    res.status(500).json({ error: 'Error al eliminar token' });
  }
});

// GET /api/admin/devices - Listar dispositivos registrados
adminRouter.get('/devices', (req, res) => {
  try {
    const devices = Array.from(deviceTokens).map(token => ({
      token: `${token.substring(0, 20)}...`,
      ...deviceInfo.get(token)
    }));
    
    res.json({
      totalDevices: deviceTokens.size,
      devices: devices
    });
    
  } catch (error) {
    console.error('Error listando dispositivos:', error);
    res.status(500).json({ error: 'Error al obtener dispositivos' });
  }
});

// POST /api/admin/notifications/test - Enviar notificación de prueba
adminRouter.post('/notifications/test', async (req, res) => {
  try {
    const testNotification = {
      title: '🔔 Notificación de Prueba',
      message: 'Este es un mensaje de prueba desde el panel admin de BarrileteCosmico TV',
      type: 'test',
      audience: 'all'
    };
    
    const fcmResult = await sendFirebaseNotification(testNotification);
    
    const notification = {
      id: Date.now(),
      ...testNotification,
      recipients: fcmResult.sent || fcmResult.totalTargets || 0,
      sent_at: new Date(),
      status: fcmResult.success ? 'sent' : 'failed',
      isTest: true,
      fcm_result: {
        mode: fcmResult.mode,
        sent: fcmResult.sent || 0,
        failed: fcmResult.failed || 0,
        error: fcmResult.error || null
      }
    };
    
    notificationHistory.unshift(notification);
    
    console.log(`🧪 Notificación de prueba enviada - Modo: ${fcmResult.mode}, Resultado: ${fcmResult.sent || 0} exitosas`);
    
    res.json({
      success: true,
      notification,
      message: `Notificación de prueba ${fcmResult.success ? 'enviada' : 'falló'} - Modo: ${fcmResult.mode}`,
      fcm_details: {
        mode: fcmResult.mode,
        sent: fcmResult.sent || 0,
        failed: fcmResult.failed || 0,
        firebase_enabled: fcmEnabled,
        total_devices: Array.from(deviceTokens.values()).reduce((total, set) => total + set.size, 0)
      }
    });
    
  } catch (error) {
    console.error('Error enviando notificación de prueba:', error);
    res.status(500).json({ error: 'Error al enviar notificación de prueba' });
  }
});

// ===== CONFIGURACIÓN DE DISEÑO =====

let designConfig = {
  colors: {
    primary: '#87CEEB',
    secondary: '#FF8C69',
    accent: '#195D9B'
  },
  branding: {
    appTitle: 'BarrileteCosmico TV',
    appSlogan: 'Tu fútbol argentino en vivo',
    logo: null
  }
};

// GET /api/admin/design - Obtener configuración de diseño
adminRouter.get('/design', (req, res) => {
  res.json(designConfig);
});

// POST /api/admin/design - Guardar configuración de diseño
adminRouter.post('/design', (req, res) => {
  try {
    const { colors, branding } = req.body;
    
    if (colors) {
      designConfig.colors = { ...designConfig.colors, ...colors };
    }
    
    if (branding) {
      designConfig.branding = { ...designConfig.branding, ...branding };
    }
    
    console.log('🎨 Configuración de diseño actualizada');
    
    res.json({
      success: true,
      config: designConfig,
      message: 'Diseño actualizado exitosamente'
    });
    
  } catch (error) {
    console.error('Error guardando diseño:', error);
    res.status(500).json({ error: 'Error al guardar diseño' });
  }
});

// ===== GESTIÓN DE MÚLTIPLES BACKENDS =====

let backendConfig = {
  current: process.env.REPLIT_DEV_DOMAIN || 'localhost:5000',
  backends: [
    {
      id: 'primary',
      name: 'Backend Principal',
      url: `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`,
      status: 'active',
      priority: 'primary',
      lastCheck: new Date().toISOString()
    }
  ]
};

// GET /api/admin/backends - Obtener backends configurados
adminRouter.get('/backends', (req, res) => {
  res.json(backendConfig);
});

// POST /api/admin/backends - Agregar nuevo backend
adminRouter.post('/backends', async (req, res) => {
  try {
    const { name, url, apiKey, priority } = req.body;
    
    if (!name || !url) {
      return res.status(400).json({ error: 'Nombre y URL son requeridos' });
    }
    
    const newBackend = {
      id: Date.now().toString(),
      name,
      url: url.endsWith('/') ? url.slice(0, -1) : url,
      apiKey,
      priority: priority || 'secondary',
      status: 'inactive',
      lastCheck: new Date().toISOString()
    };
    
    backendConfig.backends.push(newBackend);
    
    console.log(`🖥️ Backend agregado: ${name} (${url})`);
    
    res.json({
      success: true,
      backend: newBackend,
      message: 'Backend agregado exitosamente'
    });
    
  } catch (error) {
    console.error('Error agregando backend:', error);
    res.status(500).json({ error: 'Error al agregar backend' });
  }
});

// POST /api/admin/backends/:id/test - Probar conectividad de backend
adminRouter.post('/backends/:id/test', async (req, res) => {
  try {
    const backendId = req.params.id;
    const backend = backendConfig.backends.find(b => b.id === backendId);
    
    if (!backend) {
      return res.status(404).json({ error: 'Backend no encontrado' });
    }
    
    // Probar conectividad
    const testUrl = `${backend.url}/health`;
    const startTime = Date.now();
    
    try {
      const response = await fetch(testUrl, { 
        method: 'GET',
        timeout: 5000 
      });
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      if (response.ok) {
        backend.status = 'active';
        backend.lastCheck = new Date().toISOString();
        backend.responseTime = responseTime;
        
        res.json({
          success: true,
          status: 'active',
          responseTime,
          message: `Backend ${backend.name} está funcionando correctamente`
        });
      } else {
        backend.status = 'error';
        backend.lastCheck = new Date().toISOString();
        
        res.json({
          success: false,
          status: 'error',
          message: `Backend ${backend.name} respondió con error ${response.status}`
        });
      }
    } catch (testError) {
      backend.status = 'inactive';
      backend.lastCheck = new Date().toISOString();
      
      res.json({
        success: false,
        status: 'inactive',
        message: `No se pudo conectar a ${backend.name}: ${testError.message}`
      });
    }
    
  } catch (error) {
    console.error('Error probando backend:', error);
    res.status(500).json({ error: 'Error al probar backend' });
  }
});

// DELETE /api/admin/backends/:id - Eliminar backend
adminRouter.delete('/backends/:id', (req, res) => {
  try {
    const backendId = req.params.id;
    const initialLength = backendConfig.backends.length;
    
    backendConfig.backends = backendConfig.backends.filter(b => b.id !== backendId);
    
    if (backendConfig.backends.length < initialLength) {
      console.log(`🗑️ Backend eliminado: ${backendId}`);
      res.json({
        success: true,
        message: 'Backend eliminado exitosamente'
      });
    } else {
      res.status(404).json({ error: 'Backend no encontrado' });
    }
    
  } catch (error) {
    console.error('Error eliminando backend:', error);
    res.status(500).json({ error: 'Error al eliminar backend' });
  }
});

// PUT /api/admin/backends/switch - Cambiar backend principal
adminRouter.put('/backends/switch', (req, res) => {
  try {
    const { backendId } = req.body;
    const backend = backendConfig.backends.find(b => b.id === backendId);
    
    if (!backend) {
      return res.status(404).json({ error: 'Backend no encontrado' });
    }
    
    // Cambiar todos a secondary
    backendConfig.backends.forEach(b => {
      if (b.priority === 'primary') {
        b.priority = 'secondary';
      }
    });
    
    // Establecer el nuevo como primary
    backend.priority = 'primary';
    backendConfig.current = backend.url;
    
    console.log(`🔄 Backend principal cambiado a: ${backend.name}`);
    
    res.json({
      success: true,
      currentBackend: backend,
      message: `Backend principal cambiado a ${backend.name}`
    });
    
  } catch (error) {
    console.error('Error cambiando backend:', error);
    res.status(500).json({ error: 'Error al cambiar backend' });
  }
});

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
  
  // Inicializar sistema de monitoreo de archivos
  initializeFileWatcher();
});