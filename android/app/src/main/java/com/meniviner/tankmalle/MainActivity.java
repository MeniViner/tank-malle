package com.meniviner.tankmalle;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(TankRemotePushPlugin.class);
        super.onCreate(state);
    }
}
