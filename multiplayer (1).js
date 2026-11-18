// multiplayer.js - PeerJS (WebRTC) lobby-code networking for FC Soccer Bros.
// Star topology: the HOST creates a 5-character Lobby Code, up to 7 GUESTS join (8 players total).
// No backend needed, so it works from GitHub Pages and on school networks.
const Net = (() => {
  let peer = null, conns = {}, hostConn = null, role = null;
  const MAX_GUESTS = 7;
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

  function genCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]; return s; }
  function available() { return typeof Peer !== 'undefined'; }
  function freeId() { for (let i = 1; i <= MAX_GUESTS; i++) if (!conns[i]) return i; return null; }

  // cb: { onCode(code), onJoin(id), onLeave(id), onData(id,msg), onError(msg) }
  function createLobby(cb) {
    close(); role = 'host';
    if (!available()) { cb.onError && cb.onError('PeerJS did not load (CDN blocked?). Use Quick Match local 2-player instead.'); return; }
    let tries = 0;
    const attempt = () => {
      const code = genCode();
      peer = new Peer('fcsb-' + code, { debug: 0 });
      peer.on('open', () => cb.onCode && cb.onCode(code));
      peer.on('connection', c => {
        const id = freeId();
        if (id === null) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => { try { c.close(); } catch (e) {} }, 300); }); return; }
        conns[id] = c;
        c.on('open', () => { c.send({ t: 'welcome', id }); cb.onJoin && cb.onJoin(id); });
        c.on('data', d => cb.onData && cb.onData(id, d));
        c.on('close', () => { delete conns[id]; cb.onLeave && cb.onLeave(id); });
        c.on('error', () => { delete conns[id]; cb.onLeave && cb.onLeave(id); });
      });
      peer.on('error', err => {
        if (err && err.type === 'unavailable-id' && tries++ < 6) { try { peer.destroy(); } catch (e) {} attempt(); return; }
        cb.onError && cb.onError((err && err.type) || String(err));
      });
    };
    attempt();
  }

  // cb: { onConnect(), onData(msg), onClose(), onError(msg) }
  function joinLobby(code, cb) {
    close(); role = 'guest';
    if (!available()) { cb.onError && cb.onError('PeerJS did not load (CDN blocked?).'); return; }
    code = String(code || '').toUpperCase().trim();
    if (code.length !== 5) { cb.onError && cb.onError('Lobby codes are 5 characters.'); return; }
    peer = new Peer(undefined, { debug: 0 });
    peer.on('open', () => {
      const c = peer.connect('fcsb-' + code, { reliable: true });
      hostConn = c;
      c.on('open', () => cb.onConnect && cb.onConnect());
      c.on('data', d => cb.onData && cb.onData(d));
      c.on('close', () => { hostConn = null; cb.onClose && cb.onClose(); });
      c.on('error', e => cb.onError && cb.onError((e && e.type) || String(e)));
    });
    peer.on('error', err => {
      const t = (err && err.type) || String(err);
      cb.onError && cb.onError(t === 'peer-unavailable' ? 'Lobby not found. Check the code!' : t);
    });
  }

  const safe = (c, m) => { if (c && c.open) { try { c.send(m); } catch (e) {} } };
  function sendTo(id, msg) { safe(conns[id], msg); }                                  // host -> one guest
  function broadcast(msg) { for (const id in conns) safe(conns[id], msg); }           // host -> all guests
  function send(msg) { safe(hostConn, msg); }                                         // guest -> host
  function guestIds() { return Object.keys(conns).map(Number); }
  function connected() { return role === 'host' ? true : !!(hostConn && hostConn.open); }
  function close() {
    for (const id in conns) { try { conns[id].close(); } catch (e) {} }
    try { if (hostConn) hostConn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conns = {}; hostConn = null; peer = null; role = null;
  }
  return { createLobby, joinLobby, sendTo, broadcast, send, guestIds, connected, close, available, MAX_GUESTS };
})();
