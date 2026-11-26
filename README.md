# Bolas RA

Juego de realidad mixta (WebXR) para Meta Quest 3: se escanea la habitación, caen pelotas de goma del techo,
se cogen con la pinza o el puño, se lanzan a canastas con diana, rompen las paredes (detrás hay un mundo Matrix)
y dos pelotas iguales se fusionan. Juntar los puños y separarlos saca o guarda una raqueta.

- Jugar en el navegador de la Quest: https://smussull.github.io/bolas-ra/
- Funciona sin internet después de abrirlo una vez (service worker `sw.js`).
- Desarrollo con la Quest por USB: `./servir.sh` (sirve en http://localhost:8090 y lo abre en las gafas).
- APK instalable: se genera con `ovr-platform-util create-pwa` a partir de `manifest.webmanifest`.
