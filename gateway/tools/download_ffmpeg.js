const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// We will download a smaller, standalone ffmpeg binary from a reliable mirror if possible, 
// or use the official Gyan.dev essentials zip.
const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const zipPath = path.join(__dirname, '..', 'ffmpeg.zip');
const destDir = path.join(__dirname, '..', 'ffmpeg-temp');
const finalExe = path.join(__dirname, '..', 'ffmpeg.exe');

console.log(`[FFmpeg-Download] Target URL: ${url}`);
console.log(`[FFmpeg-Download] Saving zip to: ${zipPath}`);

function downloadFile(fileUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    
    const request = https.get(fileUrl, (response) => {
      // Handle redirects (Gyan.dev might redirect to CDN or mirror)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`[FFmpeg-Download] Redirecting (${response.statusCode}) to: ${response.headers.location}`);
        downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Server returned status code ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastReportTime = Date.now();

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const now = Date.now();
        if (now - lastReportTime > 2000) {
          const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
          console.log(`[FFmpeg-Download] Progress: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB)`);
          lastReportTime = now;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('[FFmpeg-Download] Download completed successfully.');
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

async function run() {
  try {
    await downloadFile(url, zipPath);
    
    console.log('[FFmpeg-Download] Extracting zip file using PowerShell...');
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.mkdirSync(destDir);

    const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}'"`;
    console.log(`[FFmpeg-Download] Running: ${cmd}`);
    
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('[FFmpeg-Download] Extraction failed:', err.message);
        console.error(stderr);
        return;
      }
      console.log('[FFmpeg-Download] Extraction finished. Finding ffmpeg.exe...');
      
      // Find recursively
      function findFfmpeg(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = findFfmpeg(fullPath);
            if (found) return found;
          } else if (file === 'ffmpeg.exe') {
            return fullPath;
          }
        }
        return null;
      }

      const foundPath = findFfmpeg(destDir);
      if (foundPath) {
        console.log(`[FFmpeg-Download] Found ffmpeg.exe at: ${foundPath}`);
        fs.copyFileSync(foundPath, finalExe);
        console.log(`[FFmpeg-Download] Copied ffmpeg.exe successfully to: ${finalExe}`);
        
        // Clean up
        console.log('[FFmpeg-Download] Cleaning up temp files...');
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
        console.log('[FFmpeg-Download] Cleanup complete. FFmpeg is ready!');
      } else {
        console.error('[FFmpeg-Download] Error: ffmpeg.exe not found in extracted files.');
      }
    });

  } catch (err) {
    console.error('[FFmpeg-Download] Error occurred:', err.message);
  }
}

run();
