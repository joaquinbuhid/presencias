# Sistema de Asistencias – Empresa de Seguridad
## Guía de instalación en Hostinger VPS

---

## Estructura del proyecto

```
asistencias/
├── schema.sql              ← Tablas MySQL (ejecutar primero)
├── backend/
│   ├── package.json
│   ├── server.js           ← API Node.js
│   └── .env.example        ← Copiar a .env y completar
└── frontend/
    └── public/
        └── index.html      ← App web completa (vigilador + admin)
```

---

## Paso 1 – Base de datos MySQL

1. Accedé al panel de Hostinger → **Bases de datos MySQL**
2. Creá una base de datos (ej: `seguridad_asistencias`)
3. Entrá a phpMyAdmin o conectate por SSH y ejecutá:

```bash
mysql -u TU_USUARIO -p TU_BASE_DE_DATOS < schema.sql
```

---

## Paso 2 – Subir archivos al VPS

Conectate por SSH y creá la carpeta:

```bash
mkdir -p /home/tu_usuario/asistencias
```

Subí los archivos (via SFTP, FileZilla, o Git):
- `backend/` → `/home/tu_usuario/asistencias/backend/`
- `frontend/` → `/home/tu_usuario/asistencias/frontend/`

---

## Paso 3 – Configurar variables de entorno

```bash
cd /home/tu_usuario/asistencias/backend
cp .env.example .env
nano .env
```

Completá con tus datos reales:
```
DB_HOST=localhost
DB_USER=tu_usuario_mysql
DB_PASSWORD=tu_password
DB_NAME=seguridad_asistencias
JWT_SECRET=una_clave_muy_larga_y_aleatoria_aqui
FRONTEND_URL=https://tu-dominio.com
PORT=3000
```

---

## Paso 4 – Instalar dependencias Node.js

```bash
cd /home/tu_usuario/asistencias/backend
npm install
```

---

## Paso 5 – Cambiar passwords por defecto (OBLIGATORIO)

El schema crea usuarios de prueba con password `1234`. **Generá hashes bcrypt reales:**

```bash
# En Node.js (una sola vez)
node -e "const b=require('bcrypt'); b.hash('TU_PASSWORD',10).then(h=>console.log(h))"
```

Luego actualizá en MySQL:
```sql
UPDATE vigiladores SET password='$2b$10$EL_HASH_GENERADO' WHERE usuario='jperez';
UPDATE admins SET password='$2b$10$EL_HASH_GENERADO' WHERE usuario='admin';
```

---

## Paso 6 – Actualizar coordenadas de los puestos

En MySQL, actualizá con las coordenadas reales de cada puesto:

```sql
UPDATE puestos
SET latitud=-24.78753, longitud=-65.41166, radio_metros=100
WHERE nombre='Sede Central';
```

El `radio_metros` define cuántos metros de tolerancia tiene el vigilador
para marcar desde su puesto.

---

## Paso 7 – Arrancar con PM2 (proceso permanente)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar la aplicación
cd /home/tu_usuario/asistencias/backend
pm2 start server.js --name asistencias

# Para que arranque automáticamente al reiniciar el VPS
pm2 startup
pm2 save
```

---

## Paso 8 – Nginx como proxy reverso (recomendado)

Si Hostinger usa Nginx, configurá un virtual host:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    # Frontend (archivos estáticos)
    location / {
        root /home/tu_usuario/asistencias/frontend/public;
        try_files $uri $uri/ /index.html;
    }

    # API Backend
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Usuarios de prueba (password: 1234)

| Usuario  | Tipo        | Acceso            |
|----------|-------------|-------------------|
| jperez   | Vigilador   | App de asistencia |
| mgomez   | Vigilador   | App de asistencia |
| admin    | Administrador | Panel admin     |

**Cambialos antes de poner en producción.**

---

## Agregar vigiladores

```sql
-- Primero creá el puesto si no existe
INSERT INTO puestos (nombre, latitud, longitud, radio_metros)
VALUES ('Sucursal Sur', -24.80000, -65.43000, 120);

-- Generá el hash con Node.js y luego:
INSERT INTO vigiladores (nombre, apellido, usuario, password, puesto_id)
VALUES ('Carlos', 'Lopez', 'clopez', '$2b$10$HASH_AQUI', 3);
```

---

## Notas de seguridad

- Usá HTTPS (Let's Encrypt con Certbot)
- El JWT_SECRET debe ser aleatorio y largo (mínimo 32 caracteres)
- Hacé backups periódicos de la base de datos
- Para vigiladores con celular personal: dejá `ip_asignada = NULL`
- Para dispositivos fijos de empresa: ponés la IP fija en `ip_asignada`
