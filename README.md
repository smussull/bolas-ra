# Bolas RA

Juego de realidad mixta (WebXR) para Meta Quest 3: se escanea la habitación, caen pelotas de goma del techo,
se cogen con la pinza o el puño, se lanzan a canastas con diana, rompen las paredes (detrás hay un mundo Matrix)
y dos pelotas iguales se fusionan. Juntar los puños y separarlos saca o guarda una raqueta.

- Jugar en el navegador de la Quest: https://smussull.github.io/bolas-ra/
- Funciona sin internet después de abrirlo una vez (service worker `sw.js`).
- Desarrollo con la Quest por USB: `./servir.sh` (sirve en http://localhost:8090 y lo abre en las gafas).
## App instalable en la Quest (APK)

La app es un **lanzador**: abre el juego en el navegador normal de la Quest, donde la realidad mixta funciona.
Dentro de una Trusted Web Activity (modo «2D» de Bubblewrap) el navegador desactiva WebXR, y el modo «immersive»
se queda congelado en la pantalla de carga; por eso la app no muestra el juego ella misma.

- Instalar: `adb install -r app-release-signed.apk` → en las gafas, Biblioteca → Fuentes desconocidas → Bolas RA.
- Actualizar el juego: basta con publicar en GitHub (sube `VERSION` en `sw.js`); no hace falta reinstalar la APK.
- Reconstruir la APK (`apk/` guarda lo necesario):
  1. `bubblewrap update --skipVersionUpgrade` con `apk/twa-manifest.json` (Bubblewrap de Meta: `@meta-quest/bubblewrap-cli`).
  2. Sustituir `app/src/main/java/com/smussull/bolasra/LauncherActivity.java` por `apk/LauncherActivity.java`.
  3. En Gradle: `jcenter()` → `mavenCentral()`, `compileSdkVersion 34`, `targetSdkVersion 34`.
  4. `bubblewrap build` (contraseñas en `BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD`).
- La clave de firma (`bolas-ra.keystore`) **no** está en el repositorio: guárdala aparte; sin ella no se puede actualizar la app.
- `apk/assetlinks.json` se publica en `https://smussull.github.io/.well-known/assetlinks.json` (repositorio `smussull.github.io`).
