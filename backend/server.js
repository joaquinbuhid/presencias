require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const mysql      = require('mysql2/promise');
const requestIp  = require('request-ip');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(requestIp.mw());
app.use(express.static('../frontend/public'));

// ── Pool de conexiones MySQL ──────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

// ── Helpers ───────────────────────────────────────────────────

// Distancia Haversine entre dos coordenadas (retorna metros)
function haversineMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Middleware de autenticacion JWT (vigiladores)
function authVigilador(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Sin token' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    req.user.rol = 'vigilador';
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

// Middleware de autenticacion JWT (admins)
function authAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Sin token' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

// ── RUTAS: Autenticacion vigiladores ─────────────────────────

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    const [rows] = await pool.query(
      `SELECT v.*, p.nombre AS puesto_nombre, p.latitud, p.longitud, p.radio_metros
       FROM vigiladores v
       JOIN puestos p ON p.id = v.puesto_id
       WHERE v.usuario = ? AND v.activo = 1`,
      [usuario]
    );

    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const vig = rows[0];
    const ok  = await bcrypt.compare(password, vig.password);
    if (!ok)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: vig.id, usuario: vig.usuario, puesto_id: vig.puesto_id, rol: 'vigilador' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    res.json({
      token,
      vigilador: {
        id:       vig.id,
        nombre:   vig.nombre,
        apellido: vig.apellido,
        usuario:  vig.usuario,
        puesto:   vig.puesto_nombre
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/login-admin
app.post('/api/login-admin', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM admins WHERE usuario = ?', [usuario]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const admin = rows[0];
    const ok = await bcrypt.compare(password, admin.password);
    if (!ok)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario, rol: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nombre: admin.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── RUTAS: Tipos de novedad ───────────────────────────────────

// GET /api/tipos-novedad
app.get('/api/tipos-novedad', authVigilador, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre FROM tipos_novedad WHERE activo = 1 ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── RUTAS: Registro de asistencia ────────────────────────────

// POST /api/asistencia
app.post('/api/asistencia', authVigilador, async (req, res) => {
  const { tipo_novedad_id, observaciones, latitud, longitud } = req.body;
  const vigilador_id = req.user.id;

  // Obtener IP real del cliente
  const ip_dispositivo = req.clientIp || req.ip || '0.0.0.0';

  if (!tipo_novedad_id || latitud === undefined || longitud === undefined)
    return res.status(400).json({ error: 'Datos incompletos' });

  try {
    // Datos del vigilador y su puesto
    const [vigRows] = await pool.query(
      `SELECT v.ip_asignada, p.latitud AS p_lat, p.longitud AS p_lon, p.radio_metros
       FROM vigiladores v
       JOIN puestos p ON p.id = v.puesto_id
       WHERE v.id = ?`,
      [vigilador_id]
    );

    if (!vigRows.length)
      return res.status(404).json({ error: 'Vigilador no encontrado' });

    const { ip_asignada, p_lat, p_lon, radio_metros } = vigRows[0];

    // ── Verificacion 1: IP asignada ──────────────────────────
    // Solo verificar si el vigilador tiene IP fija asignada
    if (ip_asignada) {
      // Comprobar que la IP del dispositivo coincide con la asignada
      if (ip_dispositivo !== ip_asignada) {
        return res.status(403).json({
          error: `IP no autorizada. Se esperaba ${ip_asignada}, se recibio ${ip_dispositivo}`
        });
      }

      // Verificar que esa IP no haya puesto ya asistencia de tipo "Entrada" hoy
      const hoy = new Date().toISOString().slice(0, 10);
      const [dupRows] = await pool.query(
        `SELECT id FROM novedades
         WHERE ip_dispositivo = ?
           AND tipo_novedad_id = ?
           AND DATE(fecha_hora) = ?
         LIMIT 1`,
        [ip_dispositivo, tipo_novedad_id, hoy]
      );

      if (dupRows.length) {
        return res.status(409).json({
          error: 'Esta IP ya registro esta novedad hoy'
        });
      }
    }

    // ── Verificacion 2: Ubicacion dentro del radio ────────────
    const distancia = haversineMetros(
      parseFloat(latitud), parseFloat(longitud),
      parseFloat(p_lat),   parseFloat(p_lon)
    );

    if (distancia > radio_metros) {
      return res.status(403).json({
        error: `Fuera del area permitida. Estas a ${Math.round(distancia)}m del puesto (maximo ${radio_metros}m)`
      });
    }

    // ── Insertar novedad ──────────────────────────────────────
    const [result] = await pool.query(
      `INSERT INTO novedades
         (vigilador_id, tipo_novedad_id, observaciones, ip_dispositivo, latitud, longitud, distancia_metros)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vigilador_id, tipo_novedad_id, observaciones || null,
       ip_dispositivo, latitud, longitud, Math.round(distancia)]
    );

    res.status(201).json({
      ok: true,
      novedad_id: result.insertId,
      distancia_metros: Math.round(distancia),
      mensaje: 'Asistencia registrada correctamente'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/mis-novedades  (historial del vigilador logueado)
app.get('/api/mis-novedades', authVigilador, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.id, tn.nombre AS tipo, n.observaciones,
              n.ip_dispositivo, n.distancia_metros,
              DATE_FORMAT(n.fecha_hora, '%d/%m/%Y %H:%i') AS fecha_hora
       FROM novedades n
       JOIN tipos_novedad tn ON tn.id = n.tipo_novedad_id
       WHERE n.vigilador_id = ?
       ORDER BY n.fecha_hora DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── RUTAS: Panel Admin ────────────────────────────────────────

// GET /api/admin/novedades  (todas con filtros opcionales)
app.get('/api/admin/novedades', authAdmin, async (req, res) => {
  const { fecha, vigilador_id, tipo_id } = req.query;

  let where = [];
  let params = [];

  if (fecha) {
    where.push('DATE(n.fecha_hora) = ?');
    params.push(fecha);
  }
  if (vigilador_id) {
    where.push('n.vigilador_id = ?');
    params.push(vigilador_id);
  }
  if (tipo_id) {
    where.push('n.tipo_novedad_id = ?');
    params.push(tipo_id);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const [rows] = await pool.query(
      `SELECT n.id,
              CONCAT(v.nombre, ' ', v.apellido) AS vigilador,
              v.usuario,
              p.nombre AS puesto,
              tn.nombre AS tipo_novedad,
              n.observaciones,
              n.ip_dispositivo,
              n.distancia_metros,
              DATE_FORMAT(n.fecha_hora, '%d/%m/%Y %H:%i:%s') AS fecha_hora
       FROM novedades n
       JOIN vigiladores v  ON v.id  = n.vigilador_id
       JOIN puestos p      ON p.id  = v.puesto_id
       JOIN tipos_novedad tn ON tn.id = n.tipo_novedad_id
       ${whereClause}
       ORDER BY n.fecha_hora DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/vigiladores
app.get('/api/admin/vigiladores', authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.nombre, v.apellido, v.usuario, v.ip_asignada, v.activo,
              p.nombre AS puesto
       FROM vigiladores v
       JOIN puestos p ON p.id = v.puesto_id
       ORDER BY v.apellido, v.nombre`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/puestos
app.get('/api/admin/puestos', authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM puestos ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/admin/resumen-hoy
app.get('/api/admin/resumen-hoy', authAdmin, async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM novedades WHERE DATE(fecha_hora) = ?', [hoy]
    );
    const [[{ entradas }]] = await pool.query(
      `SELECT COUNT(*) AS entradas FROM novedades n
       JOIN tipos_novedad t ON t.id = n.tipo_novedad_id
       WHERE DATE(n.fecha_hora) = ? AND t.nombre = 'Entrada'`, [hoy]
    );
    const [[{ salidas }]] = await pool.query(
      `SELECT COUNT(*) AS salidas FROM novedades n
       JOIN tipos_novedad t ON t.id = n.tipo_novedad_id
       WHERE DATE(n.fecha_hora) = ? AND t.nombre = 'Salida'`, [hoy]
    );
    const [[{ vigiladores_activos }]] = await pool.query(
      'SELECT COUNT(*) AS vigiladores_activos FROM vigiladores WHERE activo = 1'
    );

    res.json({ total, entradas, salidas, vigiladores_activos });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Arrancar servidor ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
