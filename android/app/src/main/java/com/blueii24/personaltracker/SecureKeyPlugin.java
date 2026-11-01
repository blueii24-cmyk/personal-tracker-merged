package com.blueii24.personaltracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * Stores the user's own AI-provider API key encrypted with an AES-256-GCM key that lives in the Android Keystore
 * (non-exportable, bound to this app). Only the ciphertext is written to app-private SharedPreferences, and that file
 * is excluded from Android backups (see backup_rules.xml / data_extraction_rules.xml) because the Keystore key can't
 * be restored on another device.
 *
 * This protects the key at rest. It does not hide it from code running inside the app or from someone who controls
 * a rooted/debuggable device. The key is never logged.
 */
@CapacitorPlugin(name = "SecureKey")
public class SecureKeyPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "personal_tracker_ai_key_v1";
    static final String PREFS = "pt_secure_key";
    private static final String K_DATA = "d";
    private static final String K_IV = "i";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return (SecretKey) ks.getKey(ALIAS, null);
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        gen.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("No value to store.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] iv = cipher.getIV();
            byte[] data = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            boolean ok = prefs()
                .edit()
                .putString(K_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(K_DATA, Base64.encodeToString(data, Base64.NO_WRAP))
                .commit();
            if (ok) call.resolve();
            else call.reject("Could not write secure storage.");
        } catch (Exception e) {
            call.reject("Secure storage is unavailable on this device.");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        SharedPreferences p = prefs();
        String iv = p.getString(K_IV, null);
        String data = p.getString(K_DATA, null);
        if (iv == null || data == null) {
            ret.put("value", JSONObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(data, Base64.NO_WRAP));
            ret.put("value", new String(plain, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            // The Keystore key is gone or the data is damaged (for example after a restore or a reset of the
            // lock screen). Drop it so the user is simply asked for the key again.
            p.edit().clear().commit();
            ret.put("value", JSONObject.NULL);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        prefs().edit().clear().commit();
        call.resolve();
    }
}
