package studio.koma.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hosts the packaged web app. No network, storage or camera permission is needed. */
public final class MainActivity extends Activity {
    private static final String HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int PICK = 101, WRITE = 102;
    private static final long MAX_EXPORT = 72L * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, PendingExport> incoming = new HashMap<>();
    private WebView web;
    private WindowInsets latestInsets;
    private ValueCallback<Uri[]> fileCallback;
    private PendingExport waitingForDocument;
    private boolean ready;

    private static final class PendingExport {
        final File file;
        final String name, mime;
        final boolean share;
        PendingExport(File file, String name, String mime, boolean share) {
            this.file=file; this.name=name; this.mime=mime; this.share=share;
        }
    }

    private static boolean ownOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPort() == -1 && uri.getEncodedPath() != null && uri.getEncodedPath().startsWith("/assets/");
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        final Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        else window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 28) {
            android.view.WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false); window.setNavigationBarContrastEnforced(false);
        }
        window.setNavigationBarColor(Color.TRANSPARENT); window.setStatusBarColor(Color.TRANSPARENT);
        WebView.setWebContentsDebuggingEnabled(false);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(18, 20, 28));
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            latestInsets=insets; sendInsets(); return insets;
        });
        WebSettings config = web.getSettings();
        config.setJavaScriptEnabled(true);
        config.setDomStorageEnabled(true);
        config.setAllowFileAccess(false);
        config.setAllowContentAccess(true); // Selected content:// URIs are passed to Chromium's file input broker.
        config.setAllowFileAccessFromFileURLs(false);
        config.setAllowUniversalAccessFromFileURLs(false);
        config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        config.setSupportMultipleWindows(false);
        config.setJavaScriptCanOpenWindowsAutomatically(false);
        config.setMediaPlaybackRequiresUserGesture(true);
        config.setSupportZoom(false);
        config.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder().setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.isForMainFrame() || !ownOrigin(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                final Uri uri=request.getUrl();
                if (!ownOrigin(uri)) return response("text/plain", 403, "Forbidden", new ByteArrayInputStream(new byte[0]));
                final WebResourceResponse local=loader.shouldInterceptRequest(uri);
                if (local==null || local.getData()==null) return response("text/plain",404,"Not Found",new ByteArrayInputStream(new byte[0]));
                final String path=uri.getPath();
                String type=local.getMimeType();
                if (path.endsWith(".wasm")) type="application/wasm";
                else if (path.endsWith(".js") || path.endsWith(".mjs")) type="text/javascript";
                else if (path.endsWith(".css")) type="text/css";
                else if (path.endsWith(".woff2")) type="font/woff2";
                else if (path.endsWith(".webp")) type="image/webp";
                else if (path.endsWith(".svg")) type="image/svg+xml";
                else if (path.endsWith(".webmanifest")) type="application/manifest+json";
                else if (path.endsWith(".vrm") || path.endsWith(".task") || type==null) type="application/octet-stream";
                return response(type,200,"OK",local.getData());
            }
            @Override public void onPageFinished(WebView view, String url) {
                ready=START.equals(url); sendInsets();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                ready=false;
                if (view.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup)view.getParent()).removeView(view);
                view.destroy();web=null;
                Toast.makeText(MainActivity.this,"WebView stopped. Reopen KomaStudio to continue.",Toast.LENGTH_LONG).show();
                finish();return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback!=null) fileCallback.onReceiveValue(null);
                fileCallback=callback;
                String accept= Arrays.toString(parameters.getAcceptTypes()).toLowerCase(Locale.ROOT);
                final Intent intent;
                if (accept.contains("image/") && !accept.contains("model/")) {
                    ActivityResultContracts.PickVisualMedia picker = new ActivityResultContracts.PickVisualMedia();
                    intent=picker.createIntent(MainActivity.this,new PickVisualMediaRequest.Builder()
                            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build());
                } else {
                    String[] types=accept.contains("json") ? new String[]{"application/json","text/plain","application/octet-stream"}
                        : new String[]{"model/gltf-binary","application/gltf-buffer","application/x-vrm","application/octet-stream"};
                    intent=new ActivityResultContracts.OpenDocument().createIntent(MainActivity.this,types);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                }
                try { startActivityForResult(intent,PICK); }
                catch (ActivityNotFoundException e) {
                    try { startActivityForResult(new ActivityResultContracts.OpenDocument().createIntent(MainActivity.this,
                          new String[]{accept.contains("image/")?"image/*":"*/*"}).addCategory(Intent.CATEGORY_OPENABLE),PICK); }
                    catch (ActivityNotFoundException unavailable) { fileCallback.onReceiveValue(null);fileCallback=null; }
                }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "KomaAndroid");
        setContentView(web);
        web.requestApplyInsets();
        web.loadUrl(START);
        io.execute(() -> SharedExportProvider.prune(this));
    }

    private static WebResourceResponse response(String type, int code, String reason, java.io.InputStream stream) {
        final Map<String,String> h=new HashMap<>();
        h.put("Cross-Origin-Opener-Policy","same-origin");
        h.put("Cross-Origin-Embedder-Policy","require-corp");
        h.put("Cross-Origin-Resource-Policy","same-origin");
        h.put("X-Content-Type-Options","nosniff");
        h.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; "
                +"img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'");
        return new WebResourceResponse(type, type.startsWith("text/") ? "UTF-8" : null, code, reason, h, stream);
    }

    private void sendInsets() {
        if (!ready || latestInsets==null || web==null) return;
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT>=30) {
            Insets values=latestInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            left=values.left;top=values.top;right=values.right;bottom=values.bottom;
        } else {
            left=latestInsets.getStableInsetLeft();top=latestInsets.getStableInsetTop();
            right=latestInsets.getStableInsetRight();bottom=latestInsets.getStableInsetBottom();
            if (Build.VERSION.SDK_INT>=28) {
                DisplayCutout cutout=latestInsets.getDisplayCutout();
                if(cutout!=null){left=Math.max(left,cutout.getSafeInsetLeft());top=Math.max(top,cutout.getSafeInsetTop());right=Math.max(right,cutout.getSafeInsetRight());bottom=Math.max(bottom,cutout.getSafeInsetBottom());}
            }
        }
        float density=getResources().getDisplayMetrics().density;
        String js=String.format(Locale.US,"(()=>{let s=document.documentElement.style;s.setProperty('--safe-l','%.2fpx');s.setProperty('--safe-t','%.2fpx');s.setProperty('--safe-r','%.2fpx');s.setProperty('--safe-b','%.2fpx')})()",left/density,top/density,right/density,bottom/density);
        web.evaluateJavascript(js,null);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        final Uri uri=result==RESULT_OK && data!=null ? data.getData() : null;
        if (request==PICK && fileCallback!=null) {
            ValueCallback<Uri[]> callback=fileCallback;fileCallback=null;
            callback.onReceiveValue(uri!=null&&"content".equals(uri.getScheme())?new Uri[]{uri}:null);
        } else if(request==WRITE && waitingForDocument!=null) {
            PendingExport pending=waitingForDocument; waitingForDocument=null;
            if(uri==null){pending.file.delete();publish("Export cancelled");}
            else io.execute(() -> {
                try { write(uri,pending.file);publish("Saved " + pending.name); }
                catch(IOException|RuntimeException e){publish("Could not save the file");}
                finally {pending.file.delete();}
            });
        }
    }
    private void publish(String message) {
        runOnUiThread(() -> {
            if(!ready||isFinishing()||web==null)return;
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('komaexport',{detail:{message:"+JSONObject.quote(message)+"}}))",null);
        });
    }
    private void write(Uri uri, File file) throws IOException {
        try (FileInputStream in=new FileInputStream(file); OutputStream out=getContentResolver().openOutputStream(uri,"w")) {
            if(out==null)throw new IOException("No output stream");
            byte[] buffer=new byte[65536]; int n; while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
        }
    }
    private void finishExport(PendingExport pending) {
        if (pending.share) {
            final Uri uri=SharedExportProvider.uri(pending.file,pending.name);
            runOnUiThread(() -> {
                if(isFinishing()){pending.file.delete();return;}
                Intent share=new Intent(Intent.ACTION_SEND).setType(pending.mime).putExtra(Intent.EXTRA_STREAM,uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                share.setClipData(ClipData.newUri(getContentResolver(),pending.name,uri));
                try{startActivity(Intent.createChooser(share,"Share from KomaStudio"));}
                catch(ActivityNotFoundException e){publish("No app can share this file");}
            });
        } else if(Build.VERSION.SDK_INT>=29 && "image/png".equals(pending.mime)) {
            Uri target=null;
            try {
                final ContentResolver resolver=getContentResolver();
                ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.DISPLAY_NAME,pending.name);
                values.put(MediaStore.Images.Media.MIME_TYPE,pending.mime);values.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/KomaStudio");
                values.put(MediaStore.Images.Media.IS_PENDING,1);
                target=resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);
                if(target==null)throw new IOException("No MediaStore URI");
                write(target,pending.file);values.clear();values.put(MediaStore.Images.Media.IS_PENDING,0);resolver.update(target,values,null,null);
                publish("Saved to Pictures/KomaStudio");
            } catch(IOException|RuntimeException e) {
                if(target!=null)try{getContentResolver().delete(target,null,null);}catch(RuntimeException ignored){}
                publish("Could not save the PNG");
            } finally {pending.file.delete();}
        } else runOnUiThread(() -> {
            if(isFinishing()||waitingForDocument!=null){pending.file.delete();publish("Another export is already in progress");return;}
            waitingForDocument=pending;
            try {startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(pending.mime).putExtra(Intent.EXTRA_TITLE,pending.name),WRITE);}
            catch(ActivityNotFoundException e){waitingForDocument=null;pending.file.delete();publish("No document provider is available");}
        });
    }
    public final class Bridge {
        @JavascriptInterface public String beginExport(String name,String mime,boolean share) {
            if(!"image/png".equals(mime)&&!"application/json".equals(mime))return "";
            final String ext="image/png".equals(mime)?".png":".json";
            final String clean=(name==null?"KomaStudio":name).replaceAll("[\\p{Cntrl}/\\\\:]+","-").trim();
            final String safe=clean.length()>110?clean.substring(0,110):clean;
            final String id=UUID.randomUUID().toString().replace("-","");
            synchronized(incoming) {
                if(incoming.size()>=3)return "";
                final File dir=SharedExportProvider.directory(MainActivity.this);
                if(!dir.isDirectory()&&!dir.mkdirs())return "";
                final File file=new File(dir,id+ext);
                try {if(!file.createNewFile())return "";}catch(IOException e){return "";}
                incoming.put(id,new PendingExport(file,safe.toLowerCase(Locale.ROOT).endsWith(ext)?safe:safe+ext,mime,share));return id;
            }
        }
        @JavascriptInterface public boolean appendExport(String id,String chunk) {
            if(chunk==null||chunk.length()>382000)return false;
            synchronized(incoming) {
                final PendingExport pending=incoming.get(id);
                if(pending==null||pending.file.length()+chunk.length()>MAX_EXPORT)return false;
                try(FileOutputStream out=new FileOutputStream(pending.file,true)) {out.write(Base64.decode(chunk,Base64.DEFAULT));return true;}
                catch(IOException|IllegalArgumentException e){return false;}
            }
        }
        @JavascriptInterface public void finishExport(String id,boolean complete) {
            final PendingExport pending;
            synchronized(incoming){pending=incoming.remove(id);}
            if(pending==null)return;
            if(complete && pending.file.length()>0) {try{io.execute(()->MainActivity.this.finishExport(pending));}catch(java.util.concurrent.RejectedExecutionException e){pending.file.delete();}}
            else pending.file.delete();
        }
    }
    @Override public void onBackPressed() {
        if(ready&&web!=null)web.evaluateJavascript("Boolean(window.komaBack && window.komaBack())", handled->{if(!"true".equals(handled))finish();});
        else finish();
    }
    @Override protected void onDestroy() {
        ready=false;
        if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}
        synchronized(incoming){for(PendingExport p:incoming.values())p.file.delete();incoming.clear();}
        if(waitingForDocument!=null)waitingForDocument.file.delete();
        if(web!=null){web.removeJavascriptInterface("KomaAndroid");web.stopLoading();web.destroy();web=null;}
        io.shutdown();super.onDestroy();
    }
}
