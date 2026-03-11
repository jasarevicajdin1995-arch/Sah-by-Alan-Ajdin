try {
  importScripts("https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js");
} catch (error) {
  postMessage(`info string stockfish-load-error ${error?.message || error}`);
}
