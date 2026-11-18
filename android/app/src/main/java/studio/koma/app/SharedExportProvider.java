package studio.koma.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/** Shares only named, read-only, per-export cache files through transient URI grants. */
public final class SharedExportProvider extends ContentProvider {
    private static final String AUTHORITY="studio.koma.app.exports";
    public static File directory(Context context){return new File(context.getCacheDir(),"shared-exports");}
    public static Uri uri(File file,String name){return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(file.getName()).appendPath(name).build();}
    public static void prune(Context context){
        File[] files=directory(context).listFiles();if(files==null)return;
        final long cutoff=System.currentTimeMillis()-86400000L;
        for(File file:files)if(file.lastModified()<cutoff)file.delete();
    }
    private File resolve(Uri uri) throws FileNotFoundException {
        List<String> parts=uri.getPathSegments();
        if(parts.size()!=2||!parts.get(0).matches("[a-f0-9]{32}\\.(?:png|json)"))throw new FileNotFoundException("Unknown export");
        File file=new File(directory(getContext()),parts.get(0));
        if(!file.isFile())throw new FileNotFoundException("Export expired");
        return file;
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){try{return resolve(uri).getName().endsWith(".png")?"image/png":"application/json";}catch(FileNotFoundException e){return null;}}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        if(!"r".equals(mode))throw new FileNotFoundException("Exports are read-only");
        return ParcelFileDescriptor.open(resolve(uri),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] arguments,String sort){
        if(projection==null)projection=new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE};
        MatrixCursor c=new MatrixCursor(projection,1);
        try {
            final File file=resolve(uri);Object[] row=new Object[projection.length];
            for(int i=0;i<projection.length;i++){
                if(OpenableColumns.DISPLAY_NAME.equals(projection[i]))row[i]=uri.getLastPathSegment();
                else if(OpenableColumns.SIZE.equals(projection[i]))row[i]=file.length();
            }c.addRow(row);
        } catch(FileNotFoundException ignored){}
        return c;
    }
    @Override public Uri insert(Uri uri,ContentValues value){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] arguments){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] arguments){throw new UnsupportedOperationException();}
}
