# Ryze

Bot de Discord para **canales de voz temporales** ("Join to Create"), con **anti-spam** y un **panel de administración que se abre como Activity** dentro de Discord.

- **Canales temporales**: entras al canal lobby, Ryze te crea tu propio canal y lo borra cuando queda vacío.
- **Anti-spam**: detecta el mismo enlace en varios canales (o palabras bloqueadas como estafas de "MrBeast" o "Nitro gratis"), borra los mensajes, aplica timeout y avisa en el canal de alertas mencionando a los admins.
- **Panel (Activity)** que se abre dentro de Discord:
  - **Todos los miembros** ven **Mi canal**: cambiar nombre y límite, bloquear o desbloquear, permitir o bloquear personas, expulsar, pasar el canal a otro, reclamar un canal sin dueño y guardar sus preferencias para la próxima vez.
  - **Dueño y managers** ven además el botón **Configurar Ryze**: canales temporales, anti-spam, quién más puede administrar y el registro de actividad.

Hecho en TypeScript con discord.js v14, Express y SQLite (`node:sqlite`). El panel usa React (TSX), Tailwind CSS v4, lucide-react y Vite.

---

## Comandos

| Comando | Quién | Qué hace |
| --- | --- | --- |
| `/voice lock` · `/voice unlock` | Dueño del canal | Bloquea o desbloquea el canal |
| `/voice permit @usuario` | Dueño del canal | Deja entrar a alguien |
| `/voice reject @usuario` | Dueño del canal | Lo saca y le quita el acceso |
| `/voice limit <0-99>` | Dueño del canal | Límite de usuarios |
| `/voice name <nombre>` | Dueño del canal | Cambia el nombre (se recuerda) |
| `/voice claim` | Cualquiera en el canal | Se queda con el canal si el dueño se fue |
| `/voice setup` | Dueño / managers | Crea la categoría y el canal lobby |
| `/panel` | Todos | Abre el panel (Activity): Mi canal, y Configurar Ryze para admins |
| `/help` | Todos | Ayuda |

El panel también se abre desde el lanzador de apps (🚀) de Discord → **Ryze**, y desde el botón que trae cada alerta de spam.

**Permisos:** cualquier miembro puede abrir el panel y gestionar su propio canal. El dueño del servidor siempre ve **Configurar Ryze**. Desde **Configurar Ryze → Permisos** puede agregar usuarios o roles como *managers*, que pueden configurar todo menos la lista de managers. Si en *Canales de voz* se desactiva la personalización, los miembros pueden seguir bloqueando y permitiendo personas, pero no cambiar el nombre ni el límite.

---

## 1. Configurar la aplicación en el Developer Portal

En <https://discord.com/developers/applications> → tu aplicación:

1. **Bot**
   - Copia el token (`DISCORD_TOKEN`).
   - En *Privileged Gateway Intents* activa **Server Members Intent** y **Message Content Intent** (el anti-spam necesita leer los enlaces).
2. **General Information** → copia el *Application ID* (`DISCORD_CLIENT_ID`).
3. **OAuth2**
   - Copia el *Client Secret* (`DISCORD_CLIENT_SECRET`).
   - En *Redirects* agrega `https://127.0.0.1` (Discord lo exige aunque la Activity no lo usa).
4. **Activities → Settings** → activa **Enable Activities**. Elige que se pueda lanzar en servidores.
5. **Activities → URL Mappings** → agrega:

   | Prefix | Target |
   | --- | --- |
   | `/` | `ryze.tudominio.com` (tu dominio público, **sin** `https://`) |

6. **Invitar el bot** con estos permisos (Gestionar canales, Gestionar roles, Mover miembros, Aislar temporalmente, Gestionar mensajes, Enviar mensajes, Ver canales, Conectar, Insertar enlaces, Leer historial):

   ```
   https://discord.com/oauth2/authorize?client_id=TU_CLIENT_ID&permissions=1099797982224&scope=bot+applications.commands
   ```

   > El rol de Ryze debe estar **por encima** de los roles de los usuarios a los que tiene que aplicar timeout. Los administradores no pueden recibir timeout.

---

## 2. Ejecutar con Docker

```bash
cp .env.example .env      # y rellena DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
docker compose pull       # imagen publicada: ghcr.io/pixlgalaxy/ryze:latest
docker compose up -d      # o `docker compose up -d --build` para compilarla localmente
docker compose logs -f
```

La imagen se publica sola con GitHub Actions ([docker-build.yml](.github/workflows/docker-build.yml)) en cada push a `main` (`latest`, la versión de `package.json` y el SHA). Dependabot mantiene al día npm, la imagen base y las Actions; los PRs minor/patch se fusionan solos cuando el build pasa y los major esperan revisión.

- El contenedor expone el puerto **3000** (panel + API). Cámbialo en el host con `RYZE_PORT` en `.env`.
- **Datos persistentes**: todo se guarda en `/appdata` dentro del contenedor, montado en `./appdata` del host (base de datos `ryze.db`). Haz backup de esa carpeta.
- **Migración del bot antiguo**: si pones el `voice.db` del bot de Python en `./appdata/voice.db`, la primera vez que arranca se importa la configuración (canal lobby, categoría y límite por servidor).
- Healthcheck: `GET /api/health`.

Sin compose:

```bash
docker build -t ryze .
docker run -d --name ryze --restart unless-stopped --env-file .env \
  -p 3000:3000 -v "$(pwd)/appdata:/appdata" ryze
```

---

## 3. Publicar el panel con HTTPS

Discord solo carga Activities desde una URL **HTTPS pública**. Ryze sirve HTTP en el puerto 3000; pon delante un proxy con certificado. Después, usa ese dominio en *URL Mappings* (paso 1.5).

### Opción A: Nginx Proxy Manager

1. En NPM → **Hosts → Proxy Hosts → Add Proxy Host**.
2. *Details*:
   - **Domain Names**: `ryze.tudominio.com` (con un registro DNS A/CNAME apuntando a tu servidor).
   - **Scheme**: `http`
   - **Forward Hostname / IP**: la IP del servidor donde corre Ryze, o `ryze` si NPM está en la misma red de Docker que el contenedor.
   - **Forward Port**: `3000` (o el `RYZE_PORT` que hayas puesto).
   - Activa **Block Common Exploits**.
3. *SSL*: **Request a new SSL Certificate** (Let's Encrypt), activa **Force SSL** y **HTTP/2 Support**.
4. Guarda y comprueba que `https://ryze.tudominio.com/api/health` responde `{"ok":true,...}`.

Si NPM y Ryze comparten red de Docker, puedes quitar `ports:` del compose y unirlos así:

```yaml
services:
  ryze:
    # ...
    networks: [npm]
networks:
  npm:
    external: true   # el nombre de la red de tu Nginx Proxy Manager
```

### Opción B: Cloudflare Tunnel

No necesitas abrir puertos ni tener IP pública.

1. En Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** (tipo *Cloudflared*). Copia el token.
2. Añade el conector a tu `docker-compose.yml`:

   ```yaml
   services:
     ryze:
       # ...
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
       depends_on: [ryze]
   ```

   y `CLOUDFLARE_TUNNEL_TOKEN=...` en `.env`.
3. En el túnel → **Public Hostname → Add**:
   - **Subdomain/Domain**: `ryze.tudominio.com`
   - **Service**: `HTTP` → `ryze:3000` (si cloudflared corre en el mismo compose) o `localhost:3000` (si corre en el host).
4. Comprueba `https://ryze.tudominio.com/api/health`.

Para probar rápido sin dominio: `cloudflared tunnel --url http://localhost:3000` te da una URL `*.trycloudflare.com` temporal (cambia cada vez, hay que actualizar el URL Mapping).

---

## Desarrollo local

Requiere Node.js 22.13 o superior (recomendado 24).

```bash
npm install
cp .env.example .env     # pon DEV_GUILD_ID para que los comandos se registren al instante en tu servidor
npm run build:web        # compila el panel una vez (o usa `npm run dev:web` con un túnel al puerto 5173)
npm run dev              # bot + API con recarga automática
```

| Script | Descripción |
| --- | --- |
| `npm run dev` | Bot + servidor web con recarga (tsx) |
| `npm run dev:web` | Vite dev server del panel en :5173 (redirige `/api` a :3000) |
| `npm run build` | Compila bot (`dist/`) y panel (`dist/public/`) |
| `npm run typecheck` | Revisa tipos del bot y del panel |
| `npm start` | Ejecuta la versión compilada |

### Estructura

```
src/
  index.ts            arranque: migración, servidor web y bot
  config.ts           variables de entorno
  db.ts               SQLite: ajustes, canales temporales, registro de actividad
  settings.ts         esquemas (zod) de la configuración por servidor
  permissions.ts      dueño / managers / exentos del anti-spam
  bot/
    client.ts         cliente de discord.js y eventos
    commands.ts       slash commands y botón "Abrir panel"
    tempChannels.ts   Join to Create
    antispam.ts       detección de spam, timeout y alertas
    alerts.ts         canal de alertas y menciones
    voiceActions.ts   acciones sobre un canal (lock, permit, rename…), compartidas por /voice y el panel
  web/
    server.ts         API de admin + archivos estáticos + proxy de avatares
    member.ts         API de "Mi canal" (/api/me) para cualquier miembro
    auth.ts           login OAuth2 de la Activity, sesiones y requireAdmin
web/src/              panel: React + TSX + Tailwind + lucide-react
  App.tsx             arranque (Embedded App SDK) y cambio Mi canal ↔ Configurar Ryze
  views/MyChannel.tsx vista de miembro
  views/admin/        pestañas de configuración
  components/ui.tsx   componentes reutilizables
docker/entrypoint.sh  ajusta permisos de /appdata y baja a usuario sin privilegios
```

### Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Sí | | Token del bot |
| `DISCORD_CLIENT_ID` | Sí | | Application ID |
| `DISCORD_CLIENT_SECRET` | Sí | | Client Secret de OAuth2 |
| `DATA_DIR` | No | `./appdata` (`/appdata` en Docker) | Carpeta de datos persistentes |
| `PORT` | No | `3000` | Puerto HTTP del panel |
| `DEV_GUILD_ID` | No | | Registra los comandos solo en ese servidor |
| `PRESENCE_TEXT` | No | `/help · /voice` | Estado del bot |
| `EVENT_RETENTION_DAYS` | No | `90` | Días que se guarda el registro de actividad |
