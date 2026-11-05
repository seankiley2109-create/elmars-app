/**
 * Test-only. jsdom's Blob has no arrayBuffer() or text(); the web views Tauri uses (WKWebView,
 * WebView2) do. Fill them in from FileReader, which jsdom does have, so tests exercise the same calls.
 * Import it for its side effect from any test that reads a File the Tauri root produced.
 */

const readAs = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return readAs(this);
  };
}
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = async function (this: Blob) {
    return new TextDecoder().decode(await readAs(this));
  };
}

export {};
