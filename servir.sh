#!/bin/bash
# Sirve el juego y lo abre en la Meta Quest 3 conectada por USB-C.
# localhost en la Quest = este Mac gracias a "adb reverse" (WebXR exige localhost o https).
cd "$(dirname "$0")"
PORT=${1:-8090}
ADB=$(command -v adb || echo ~/Library/Android/sdk/platform-tools/adb)
if "$ADB" reverse tcp:$PORT tcp:$PORT; then
  "$ADB" shell am start -a android.intent.action.VIEW -d "http://localhost:$PORT" com.oculus.browser >/dev/null
  echo "Abierto en la Quest: http://localhost:$PORT"
else
  echo "No veo la Quest por adb: activa el modo desarrollador y acepta la depuración USB en las gafas."
fi
python3 -m http.server $PORT
