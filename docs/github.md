# GitHub App: configuración y límites de E3

FerWeb integra una **GitHub App**, con autorización web de usuario (OAuth + PKCE). No utiliza un PAT ni acepta un ID de instalación como prueba de propiedad. El backend consulta las instalaciones de esa App accesibles al usuario, permite conectar una de ellas y comprueba de nuevo los permisos al leer repositorios y datos guardados.

Se usa el token de usuario de la App para respetar la intersección entre permisos del usuario y de la instalación. Este flujo no necesita una clave privada/JWT de instalación: necesita Client ID y Client secret de la GitHub App. Es un modo oficial de autenticación de GitHub Apps, descrito en [generación de tokens de usuario](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Registrar y configurar la App

1. En GitHub, Settings → Developer settings → GitHub Apps → New GitHub App. Elige un nombre y anota App ID, Client ID y slug. Genera un Client secret.
2. Configura como callback de autorización `http://127.0.0.1:5173/api/github/callback`, o la URL HTTPS que corresponda a tu instancia. Debe coincidir exactamente con la configuración privada. No actives la autorización automática durante la instalación: FerWeb inicia su propio flujo con estado y PKCE desde el botón **Autorizar GitHub**.
3. Para lectura: **Contents: Read-only**, **Issues: Read-only**, **Pull requests: Read-only** y **Metadata: Read-only**. Para publicar PR desde E9, habilita **Contents: Read and write** y **Pull requests: Read and write**, acepta el cambio en la instalación y usa un usuario con permiso de escritura. No se necesitan permisos generales de organización. [Revisión y publicación](reviews.md).
4. Webhook Content type: `application/json`. Define un secreto aleatorio propio y suscribe **Push**, **Issues**, **Pull request**, **Repository**, **Create** y **Delete**. Los eventos de instalación, cambio de repositorios y revocación de autorización también se procesan. Consulta [eventos de GitHub](https://docs.github.com/en/webhooks/webhook-events-and-payloads).
5. La URL del webhook es `https://<entrada-publica>/api/github/webhook`. GitHub no puede alcanzar el loopback del PC: necesitas un proxy HTTPS o un forwarder configurado por ti. No se ha publicado FerWeb ni creado un túnel como parte de E3. Ver [pruebas de webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks).
6. Instala la App en tu usuario u organización seleccionando solo los repositorios necesarios. Las organizaciones con SAML/SSO pueden requerir una sesión SAML activa antes de autorizar.

## Configuración privada en Docker

Crear el directorio local ignorado `secrets` y copiar [github-app.example.json](github-app.example.json) a `secrets/github-app.json`. Sustituir todos los ejemplos; no pegar credenciales en la web, en el código ni en argumentos de comandos.

| Campo | Valor |
| --- | --- |
| `appId` | App ID numérico. |
| `clientId` | Client ID de la GitHub App. |
| `clientSecret` | Client secret de la App. |
| `appSlug` | Slug usado en `github.com/apps/<slug>`. |
| `webhookSecret` | Secreto aleatorio compartido con la configuración del webhook, mínimo 32 caracteres. |
| `encryptionKey` | 32 bytes aleatorios codificados en Base64, una sola línea. |
| `callbackUrl` | Callback exacto de autorización, HTTPS o HTTP local. |

Generar la clave y el secreto con un gestor de contraseñas o un generador criptográfico local. La clave de cifrado debe conservarse junto a los respaldos privados: cambiarla impide abrir tokens ya guardados, y será necesario volver a autorizar. No distribuir este JSON con el repositorio ni con las imágenes.

```powershell
npm run docker:up
```

El gestor detecta `secrets/github-app.json` e incorpora `compose.github.yaml`, que lo monta en lectura **solo en la API**. Para otra ubicación, definir `FERWEB_GITHUB_CONFIG_FILE` en la terminal antes del comando: debe estar en `secrets/`, `.local/` o fuera del repositorio. El gestor rechaza otras rutas dentro del contexto para evitar copiar credenciales a las imágenes de herramientas. No imprimir `docker compose config` sin `--quiet` si la configuración contiene otros secretos en variables.

Si existe la CA pública local de AVG/proxy, el gestor añade `compose.github-ca.yaml` a la API para que sus consultas HTTPS a GitHub puedan verificarse. La configuración de construcción `compose.ca.yaml` sigue montando la CA temporalmente; el override GitHub añade explícitamente la confianza de runtime, sin desactivar TLS. Las herramientas de prueba y el frontend no reciben la configuración privada ni la CA de runtime de la API.

Sin archivo de configuración, el resto de FerWeb funciona y la pantalla GitHub indica que falta configurar la App. Un archivo inválido hace fallar el arranque del API sin registrar valores privados.

## Recorrido

1. Entrar en FerWeb y abrir **GitHub** en el menú.
2. Pulsar **Autorizar GitHub**, completar la autorización y volver a FerWeb. El estado aleatorio dura diez minutos, está vinculado a la sesión que lo inició y se consume una sola vez. PKCE protege el intercambio del código. El callback funciona aunque la cookie `SameSite=Strict` no llegue desde el sitio externo; la sesión original se comprueba en PostgreSQL.
3. Si no aparece ninguna instalación, usar **Instalar o configurar la App**, volver y actualizar instalaciones. Pulsar **Conectar instalación**.
4. En un proyecto activo, abrir **Repositorio GitHub**, elegir instalación, repositorio y rama. Al vincular se inicia la primera sincronización. Si esta falla, el vínculo permanece disponible para reintentar.
5. Consultar archivos, contenido, issues y PR. **Sincronizar ahora** actualiza el conjunto; **Cambiar repositorio o rama** reemplaza el vínculo con control de versión; **Desvincular** elimina solo el vínculo local.
6. Archivar un proyecto permite consultar datos autorizados pero impide vincular, desvincular y sincronizar. **Desconectar de FerWeb** elimina el token local y los vínculos, conservando proyectos y tareas. No desinstala la App ni cambia permisos remotos; eso se hace en GitHub.

## Procedencia y sincronización

- El backend resuelve la rama, fija el SHA del commit, consulta su árbol y lee cada archivo por el SHA del blob que pertenece a ese árbol. Un cliente no puede pedir un blob arbitrario ni sustituir repositorio/commit en la URL de lectura. Los submódulos y enlaces simbólicos no se siguen.
- Los metadatos, issues y PR llevan fecha de observación. **Issues y PR no están versionados por el commit del código**; cada PR conserva los SHA head/base disponibles. La interfaz diferencia estas dos procedencias.
- El snapshot se guarda en PostgreSQL. Una sincronización fallida no publica resultados parciales ni sustituye el snapshot anterior. Conflictos con otro vínculo o con un webhook ocurrido durante la consulta devuelven 409 y requieren reintento.
- Los eventos de código, issues y PR marcan el snapshot como pendiente de sincronizar. **E3 no descarga automáticamente GitHub desde el webhook**: la actualización sigue siendo manual. El panel vuelve a comprobar el vínculo al recuperar foco y cada 30 segundos mientras está visible.
- Revocación de usuario, suspensión/eliminación de instalación o retirada de repositorio eliminan los snapshots correspondientes. Se comprueba acceso remoto antes de servir datos guardados y contenido, incluso si se perdió el webhook. Quitar permisos de Contents/Issues/Pull requests también bloquea y limpia el snapshot. Volver a habilitar requiere conexión explícita y nueva sincronización.
- Cambiar de cuenta GitHub durante una reautorización elimina las instalaciones/vínculos de la cuenta anterior. Los tokens expirados requieren **Volver a autorizar GitHub**; no se guarda el refresh token ni se renueva automáticamente en E3. Ver [caducidad de tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens).

## Webhooks, datos y límites

`POST /api/github/webhook` verifica HMAC-SHA256 sobre los bytes originales con comparación constante antes de parsear el JSON. El límite es 2 MB y no se admiten cuerpos comprimidos. Se registra únicamente ID de entrega, evento, hash del cuerpo, fecha y resultado; no se guarda el payload completo. Inserción y efectos se confirman en una única transacción. Una entrega idéntica repetida no repite efectos; el mismo ID con otro cuerpo/evento devuelve 409. La deduplicación sobrevive al reinicio de API porque reside en PostgreSQL. No hay todavía política automática de purga del registro. Ver [validación oficial de firmas](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Los tokens se cifran con AES-256-GCM y contexto asociado al propietario. Client secret, clave de cifrado y secreto de webhook se leen únicamente del archivo del servidor; no se guardan en PostgreSQL. Los errores HTTP no reflejan respuestas del proveedor, códigos OAuth, tokens ni configuración. El backend no registra URLs ni cabeceras de autorización. Si se añade un proxy, no habilitar logs de parámetros del callback OAuth.

Límites explícitos de E3:

- GitHub.com; no hay GitHub Enterprise Server ni base URL arbitraria.
- Hasta 1000 instalaciones, repositorios paginados de 100 en 100 y hasta 1000 repositorios para comprobar pertenencia a una instalación. Superar esos límites requiere ampliar la entrega; no se supone acceso a recursos no comprobados.
- Árbol de hasta 5000 entradas visibles y respuesta GitHub de hasta 8 MB. Si GitHub trunca el árbol o se alcanza el límite de entradas, se muestra **árbol parcial**. No es un índice completo ni hay ingesta/RAG.
- Hasta cinco páginas de 100 elementos por lista de issues/PR; el endpoint issues también devuelve PR que FerWeb filtra. Las listas parciales se indican. El cuerpo de cada descripción se limita a 20 000 caracteres.
- Solo archivos UTF-8 de hasta 1 MB, mostrados como texto. Se excluyen segmentos `.git`, `.local`, `node_modules`, `secrets`, `backups`, nombres que empiecen por `.env` y extensiones `.pem`, `.key`, `.p12`, `.pfx`, sin distinguir mayúsculas. Estas reglas no detectan todos los secretos que puedan estar escritos dentro de código permitido.
- Solicitudes externas con timeout individual de ocho segundos y presupuesto de 45 segundos por operación. La web permite hasta 60 segundos. Se comunican límites de GitHub y fallos de red sin desactivar la autorización ni sustituir resultados por datos simulados.
- Las rutas E3 son de lectura y no ejecutan código. E9 añade escritura exclusivamente desde la acción de publicación de una revisión aprobada; consulta [sus límites](reviews.md).

## Qué se valida y qué falta

Las pruebas usan PostgreSQL y HTTP reales dentro de Docker con el transporte GitHub simulado de `tests/fixtures/github.mjs`. Ese transporte solo lo inyectan los tests; no existe un interruptor de simulación en producción. La prueba de navegador inicia `tests/fixtures/server.mjs`, que usa la aplicación real y los mismos handlers con ese transporte. Se simula la redirección externa de autorización.

La comprobación real requiere proporcionar tu GitHub App y una instalación autorizada. No se han creado una App, un túnel o credenciales; no se han llamado APIs reales de repositorios ni recibido entregas reales de GitHub en esta entrega. Los resultados ejecutados están en [status.md](status.md).

Para aceptar la configuración real: autorizar una cuenta, conectar una instalación y un repositorio de prueba, comprobar el SHA de su rama y un archivo, sincronizar issues/PR, entregar dos veces un webhook real y verificar un único efecto, retirar un repositorio o revocar la autorización y comprobar que deja de mostrarse su contenido. Son validaciones explícitas y acotadas con el repositorio elegido por el propietario.
