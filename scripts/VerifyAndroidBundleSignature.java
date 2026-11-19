import java.io.OutputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Read every payload entry so the JDK checks its signed digest. */
class VerifyAndroidBundleSignature {
    private static boolean isSignatureMetadata(JarEntry entry) {
        String name = entry.getName().toUpperCase(Locale.ROOT);
        return name.equals("META-INF/MANIFEST.MF")
            || name.matches("META-INF/[^/]+\\.(SF|RSA|DSA|EC)")
            || name.matches("META-INF/SIG-[^/]+");
    }

    public static void main(String[] args) throws Exception {
        String fingerprint = null;
        var digest = MessageDigest.getInstance("SHA-256");
        try (var bundle = new JarFile(Path.of(args[0]).toFile(), true)) {
            var entries = bundle.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory() || isSignatureMetadata(entry)) continue;
                try (var input = bundle.getInputStream(entry)) {
                    input.transferTo(OutputStream.nullOutputStream());
                }
                var signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1) {
                    throw new SecurityException("Expected one verified signer for " + entry.getName());
                }
                var certificate = (X509Certificate) signers[0].getSignerCertPath().getCertificates().get(0);
                certificate.checkValidity();
                var current = HexFormat.of().formatHex(digest.digest(certificate.getEncoded()));
                if (fingerprint != null && !fingerprint.equals(current)) {
                    throw new SecurityException("Different signers among bundle entries");
                }
                fingerprint = current;
            }
        }
        if (fingerprint == null) throw new SecurityException("No signed bundle payload");
        System.out.println(fingerprint);
    }
}
