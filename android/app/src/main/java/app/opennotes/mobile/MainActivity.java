package app.opennotes.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final int PICK_SYNC_FOLDER = 4101;
    private static final int PICK_ATTACHMENT = 4102;
    private static final int REQUEST_MICROPHONE = 4103;

    private WebView webView;
    private NotesAndroidBridge notesBridge;
    private ValueCallback<Uri[]> attachmentCallback;
    private PermissionRequest pendingWebPermission;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(247, 248, 250));
        getWindow().setNavigationBarColor(Color.rgb(247, 248, 250));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 248, 250));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        notesBridge = new NotesAndroidBridge();
        webView.addJavascriptInterface(notesBridge, "AndroidNotesBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                Intent external = new Intent(Intent.ACTION_VIEW, uri);
                try {
                    startActivity(external);
                } catch (Exception ignored) {
                    // Leave unsupported links inside the app untouched.
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (attachmentCallback != null) attachmentCallback.onReceiveValue(null);
                attachmentCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, PICK_ATTACHMENT);
                    return true;
                } catch (Exception error) {
                    attachmentCallback.onReceiveValue(null);
                    attachmentCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                        } else {
                            pendingWebPermission = request;
                            requestPermissions(
                                    new String[]{Manifest.permission.RECORD_AUDIO},
                                    REQUEST_MICROPHONE
                            );
                        }
                        return;
                    }
                }
                request.deny();
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleBackNavigation
            );
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        handleBackNavigation();
    }

    private void handleBackNavigation() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_SYNC_FOLDER) {
            notesBridge.finishFolderSelection(resultCode, data);
            return;
        }
        if (requestCode == PICK_ATTACHMENT && attachmentCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    result = new Uri[count];
                    for (int index = 0; index < count; index += 1) {
                        result[index] = data.getClipData().getItemAt(index).getUri();
                    }
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            attachmentCallback.onReceiveValue(result);
            attachmentCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MICROPHONE || pendingWebPermission == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingWebPermission.deny();
        }
        pendingWebPermission = null;
    }

    public final class NotesAndroidBridge {
        private static final String PREFERENCES = "open-notes-native";
        private static final String SYNC_TREE_URI = "sync-tree-uri";
        private final Pattern syncFilename =
                Pattern.compile("^open-notes-device-[a-zA-Z0-9-]+\\.json$");
        private final ExecutorService executor = Executors.newSingleThreadExecutor();
        private String pendingFolderRequestId;

        private SharedPreferences preferences() {
            return getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        }

        private Uri getTreeUri() {
            String value = preferences().getString(SYNC_TREE_URI, null);
            return value == null ? null : Uri.parse(value);
        }

        private Uri getTreeDocumentUri(Uri treeUri) {
            return DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
            );
        }

        private String getFolderLabel(Uri treeUri) {
            Uri documentUri = getTreeDocumentUri(treeUri);
            try (Cursor cursor = getContentResolver().query(
                    documentUri,
                    new String[]{OpenableColumns.DISPLAY_NAME},
                    null,
                    null,
                    null
            )) {
                if (cursor != null && cursor.moveToFirst()) {
                    String label = cursor.getString(0);
                    if (label != null && !label.isEmpty()) return label;
                }
            } catch (Exception ignored) {
                // Some cloud document providers expose no display name for tree roots.
            }
            String fallback = treeUri.getLastPathSegment();
            return fallback == null || fallback.isEmpty() ? "Cloud folder" : fallback;
        }

        private Uri findFile(Uri treeUri, String filename) throws Exception {
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
            );
            try (Cursor cursor = getContentResolver().query(
                    childrenUri,
                    new String[]{
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME
                    },
                    null,
                    null,
                    null
            )) {
                if (cursor == null) return null;
                while (cursor.moveToNext()) {
                    if (filename.equals(cursor.getString(1))) {
                        return DocumentsContract.buildDocumentUriUsingTree(
                                treeUri,
                                cursor.getString(0)
                        );
                    }
                }
            }
            return null;
        }

        private JSONArray listFiles(Uri treeUri) throws Exception {
            JSONArray files = new JSONArray();
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
            );
            try (Cursor cursor = getContentResolver().query(
                    childrenUri,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null,
                    null,
                    null
            )) {
                if (cursor == null) return files;
                while (cursor.moveToNext()) {
                    String name = cursor.getString(0);
                    if (name != null && syncFilename.matcher(name).matches()) files.put(name);
                }
            }
            return files;
        }

        private String readText(Uri uri) throws Exception {
            try (InputStream input = getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IllegalStateException("Could not open the sync file.");
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }

        private void writeText(Uri treeUri, String filename, String contents) throws Exception {
            Uri target = findFile(treeUri, filename);
            if (target == null) {
                target = DocumentsContract.createDocument(
                        getContentResolver(),
                        getTreeDocumentUri(treeUri),
                        "application/json",
                        filename
                );
            }
            if (target == null) throw new IllegalStateException("Could not create the sync file.");
            try (OutputStream output = getContentResolver().openOutputStream(target, "rwt")) {
                if (output == null) throw new IllegalStateException("Could not write the sync file.");
                output.write(contents.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
        }

        private void sendResult(String requestId, boolean ok, Object value, String error) {
            try {
                JSONObject detail = new JSONObject();
                detail.put("requestId", requestId);
                detail.put("ok", ok);
                detail.put("value", value == null ? JSONObject.NULL : value);
                if (error != null) detail.put("error", error);
                String script =
                        "window.dispatchEvent(new CustomEvent('open-notes-native-result',{detail:"
                                + detail
                                + "}));";
                webView.post(() -> webView.evaluateJavascript(script, null));
            } catch (Exception ignored) {
                // Nothing else can receive this result if JSON encoding itself fails.
            }
        }

        private void sendError(String requestId, Exception error) {
            String message = error.getMessage();
            sendResult(
                    requestId,
                    false,
                    null,
                    message == null || message.isEmpty() ? "Android sync failed." : message
            );
        }

        @JavascriptInterface
        public void getSyncFolderLabel(String requestId) {
            executor.execute(() -> {
                Uri treeUri = getTreeUri();
                if (treeUri == null) {
                    sendResult(requestId, true, null, null);
                    return;
                }
                sendResult(requestId, true, getFolderLabel(treeUri), null);
            });
        }

        @JavascriptInterface
        public void chooseSyncFolder(String requestId) {
            runOnUiThread(() -> {
                pendingFolderRequestId = requestId;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                );
                startActivityForResult(intent, PICK_SYNC_FOLDER);
            });
        }

        private void finishFolderSelection(int resultCode, Intent data) {
            if (pendingFolderRequestId == null) return;
            String requestId = pendingFolderRequestId;
            pendingFolderRequestId = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                sendResult(requestId, true, null, null);
                return;
            }

            Uri treeUri = data.getData();
            int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            try {
                getContentResolver().takePersistableUriPermission(treeUri, flags);
                preferences().edit().putString(SYNC_TREE_URI, treeUri.toString()).apply();
                sendResult(requestId, true, getFolderLabel(treeUri), null);
            } catch (Exception error) {
                sendError(requestId, error);
            }
        }

        @JavascriptInterface
        public void listSyncFiles(String requestId) {
            executor.execute(() -> {
                try {
                    Uri treeUri = getTreeUri();
                    if (treeUri == null) throw new IllegalStateException("Choose a cloud folder first.");
                    sendResult(requestId, true, listFiles(treeUri), null);
                } catch (Exception error) {
                    sendError(requestId, error);
                }
            });
        }

        @JavascriptInterface
        public void readSyncFile(String requestId, String filename) {
            executor.execute(() -> {
                try {
                    if (!syncFilename.matcher(filename).matches()) {
                        throw new IllegalArgumentException("Invalid sync filename.");
                    }
                    Uri treeUri = getTreeUri();
                    if (treeUri == null) throw new IllegalStateException("Choose a cloud folder first.");
                    Uri file = findFile(treeUri, filename);
                    if (file == null) throw new IllegalStateException("Sync file not found.");
                    sendResult(requestId, true, readText(file), null);
                } catch (Exception error) {
                    sendError(requestId, error);
                }
            });
        }

        @JavascriptInterface
        public void writeSyncFile(String requestId, String filename, String contents) {
            executor.execute(() -> {
                try {
                    if (!syncFilename.matcher(filename).matches()) {
                        throw new IllegalArgumentException("Invalid sync filename.");
                    }
                    Uri treeUri = getTreeUri();
                    if (treeUri == null) throw new IllegalStateException("Choose a cloud folder first.");
                    writeText(treeUri, filename, contents);
                    sendResult(requestId, true, null, null);
                } catch (Exception error) {
                    sendError(requestId, error);
                }
            });
        }
    }
}
