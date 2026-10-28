// Runs Python (Pyodide, offline after first load) in a worker so the app never freezes.
// input() blocks with a synchronous request that the app's service worker answers when the user presses Enter.
importScripts('../vendor/pyodide/pyodide.js');
let py = null, inputN = 0, outBuf = '', lastSend = 0;
function sendOut() { if (outBuf) { postMessage({ t: 'out', s: outBuf }); outBuf = ''; } lastSend = Date.now(); }
const CWD = '/home/pyodide';
const dec = new TextDecoder();

function readLine() {
  const id = Date.now().toString(36) + '-' + (inputN++);
  sendOut(); postMessage({ t: 'input', id });
  const x = new XMLHttpRequest();
  x.open('GET', new URL('../__stdin__?id=' + id, self.location).href, false);
  try { x.send(null); } catch (e) { throw new Error('input() needs the installed app (open it from the home screen icon).'); }
  if (x.status !== 200) throw new Error('input() could not read from the keyboard.');
  return x.responseText;
}

async function boot() {
  postMessage({ t: 'status', s: 'Loading Python… (first time needs internet, then it works offline)' });
  py = await loadPyodide({ indexURL: new URL('../vendor/pyodide/', self.location).href });
  // printed text is sent in batches (at most every 60 ms) so a fast loop cannot flood the app
  py.setStdout({ write: buf => { outBuf += dec.decode(buf); if (outBuf.length > 4000 || Date.now() - lastSend > 60) sendOut(); return buf.length; } });
  py.setStderr({ write: buf => { sendOut(); postMessage({ t: 'err', s: dec.decode(buf) }); return buf.length; } });
  py.setStdin({ stdin: () => readLine() + '\n' });
  py.FS.chdir(CWD);
  postMessage({ t: 'ready' });
}
const ready = boot().catch(e => postMessage({ t: 'fatal', s: 'Python could not load. Open the code tab once while online so it can be saved for offline use. (' + e.message + ')' }));

onmessage = async e => {
  const m = e.data; await ready; if (!py) return;
  if (m.t !== 'run') return;
  const FS = py.FS;
  // put the app's text files into Python's folder, removing any that were deleted in the app
  for (const f of FS.readdir(CWD)) { if (f === '.' || f === '..') continue; try { if (FS.isFile(FS.stat(CWD + '/' + f).mode) && !(f in m.files)) FS.unlink(CWD + '/' + f); } catch (er) {} }
  for (const [n, t] of Object.entries(m.files)) FS.writeFile(CWD + '/' + n, t);
  py.globals.set('__src', m.code);
  try {
    py.runPython(`
import sys, traceback
import linecache
def __run():
    linecache.cache["main.py"] = (len(__src), None, __src.splitlines(True), "main.py")
    g = {"__name__": "__main__"}
    try:
        exec(compile(__src, "main.py", "exec"), g)
    except SystemExit:
        pass
    except BaseException as ex:
        tb = traceback.extract_tb(ex.__traceback__)
        tb = [f for f in tb if f.filename == "main.py"] or tb
        lines = traceback.format_list(tb)
        sys.stderr.write("Traceback (most recent call last):\\n" + "".join(lines) + "".join(traceback.format_exception_only(type(ex), ex)))
    finally:
        sys.stdout.flush(); sys.stderr.flush()
__run()
`);
  } catch (er) { sendOut(); postMessage({ t: 'err', s: String(er.message || er) + '\n' }); }
  const files = {};
  for (const f of FS.readdir(CWD)) { if (f === '.' || f === '..') continue; try { const st = FS.stat(CWD + '/' + f); if (FS.isFile(st.mode) && st.size < 2e6) files[f] = FS.readFile(CWD + '/' + f, { encoding: 'utf8' }); } catch (er) {} }
  sendOut(); postMessage({ t: 'done', files });
};
