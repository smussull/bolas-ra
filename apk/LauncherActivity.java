package com.smussull.bolasra;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Lanzador de Bolas RA: abre el juego en el navegador normal de la Quest, donde la realidad mixta
 * (WebXR immersive-ar) funciona. Dentro de una Trusted Web Activity el navegador la desactiva.
 * Sin internet funciona igual: el navegador guarda el juego (service worker) la primera vez.
 */
public class LauncherActivity extends Activity {
    private static final String URL = "https://smussull.github.io/bolas-ra/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setPackage("com.oculus.browser");
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            intent.setPackage(null);   // sin el navegador de Meta: cualquier navegador
            startActivity(intent);
        }
        finish();
    }
}
