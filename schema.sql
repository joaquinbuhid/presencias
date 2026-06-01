-- ============================================================
-- SISTEMA DE ASISTENCIAS - EMPRESA DE SEGURIDAD
-- ============================================================

CREATE DATABASE IF NOT EXISTS seguridad_asistencias
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE seguridad_asistencias;

-- ------------------------------------------------------------
-- Puestos de vigilancia (con ubicacion permitida y radio)
-- ------------------------------------------------------------
CREATE TABLE puestos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  descripcion VARCHAR(255),
  latitud     DECIMAL(10,8) NOT NULL,
  longitud    DECIMAL(11,8) NOT NULL,
  radio_metros INT NOT NULL DEFAULT 100,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Vigiladores
-- ------------------------------------------------------------
CREATE TABLE vigiladores (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  apellido    VARCHAR(100) NOT NULL,
  usuario     VARCHAR(50)  NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,  -- bcrypt hash
  puesto_id   INT NOT NULL,
  ip_asignada VARCHAR(45),            -- NULL = cualquier IP (celular personal)
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (puesto_id) REFERENCES puestos(id)
);

-- ------------------------------------------------------------
-- Tipos de novedades
-- ------------------------------------------------------------
CREATE TABLE tipos_novedad (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  descripcion VARCHAR(255),
  activo      TINYINT(1) NOT NULL DEFAULT 1
);

-- Datos iniciales de tipos de novedad
INSERT INTO tipos_novedad (nombre, descripcion) VALUES
  ('Entrada',        'Marcacion de inicio de jornada'),
  ('Salida',         'Marcacion de fin de jornada'),
  ('Novedad',        'Reporte de novedad en el puesto'),
  ('Ronda',          'Confirmacion de ronda de vigilancia'),
  ('Emergencia',     'Alerta de emergencia en el puesto');

-- ------------------------------------------------------------
-- Registro de novedades / asistencias
-- ------------------------------------------------------------
CREATE TABLE novedades (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  vigilador_id    INT NOT NULL,
  tipo_novedad_id INT NOT NULL,
  observaciones   TEXT,
  ip_dispositivo  VARCHAR(45) NOT NULL,
  latitud         DECIMAL(10,8) NOT NULL,
  longitud        DECIMAL(11,8) NOT NULL,
  distancia_metros DECIMAL(8,2),       -- distancia calculada al punto del puesto
  fecha_hora      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vigilador_id)    REFERENCES vigiladores(id),
  FOREIGN KEY (tipo_novedad_id) REFERENCES tipos_novedad(id)
);

-- Indices para busquedas frecuentes
CREATE INDEX idx_novedades_vigilador  ON novedades (vigilador_id);
CREATE INDEX idx_novedades_fecha      ON novedades (fecha_hora);
CREATE INDEX idx_novedades_ip         ON novedades (ip_dispositivo);
CREATE INDEX idx_novedades_tipo       ON novedades (tipo_novedad_id);

-- ------------------------------------------------------------
-- Sesiones activas (tokens JWT/simple)
-- ------------------------------------------------------------
CREATE TABLE sesiones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  vigilador_id  INT NOT NULL,
  token         VARCHAR(255) NOT NULL UNIQUE,
  expira_en     DATETIME NOT NULL,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vigilador_id) REFERENCES vigiladores(id)
);

-- ============================================================
-- DATOS DE EJEMPLO (puesto y admin para pruebas)
-- ============================================================

-- Puesto ejemplo (reemplazar con coordenadas reales)
INSERT INTO puestos (nombre, descripcion, latitud, longitud, radio_metros) VALUES
  ('Sede Central',  'Guardia principal entrada', -24.78753, -65.41166, 150),
  ('Planta Norte',  'Acceso planta industrial',  -24.79100, -65.40800, 100);

-- Vigilador de prueba (password: 1234  =>  hash bcrypt)
-- IMPORTANTE: cambiar el hash por uno generado con bcrypt en produccion
INSERT INTO vigiladores (nombre, apellido, usuario, password, puesto_id, ip_asignada) VALUES
  ('Juan',  'Perez',  'jperez',  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, NULL),
  ('Maria', 'Gomez',  'mgomez',  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 2, NULL);

-- Admin (usuario: admin / password: admin123)
-- Tabla separada para administradores del panel
CREATE TABLE admins (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  usuario   VARCHAR(50)  NOT NULL UNIQUE,
  password  VARCHAR(255) NOT NULL,
  nombre    VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO admins (usuario, password, nombre) VALUES
  ('admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrador');
