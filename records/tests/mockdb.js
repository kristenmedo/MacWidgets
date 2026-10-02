// In-memory stand-in for the page's `db` and `downloads` capabilities, and a
// controllable clock (window.__off, in ms), for tests only.
(function () {
  const R = Date;
  window.__off = 0;
  class FakeDate extends R {
    constructor(...a) { if (!a.length) super(R.now() + window.__off); else super(...a); }
    static now() { return R.now() + window.__off; }
  }
  window.Date = FakeDate;

  const store = new Map();
  const subs = [];
  const clone = o => JSON.parse(JSON.stringify(o));
  const snapDoc = p => {
    const d = store.get(p);
    return {id: p.split('/').pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: {}};
  };
  const notify = () => setTimeout(() => subs.forEach(f => f()), 0);
  const leases = window.__leases = [];
  const doc = p => ({
    path: p, id: p.split('/').pop(),
    get: async () => snapDoc(p),
    set: async d => { store.set(p, clone(d)); notify(); },
    update: async d => { store.set(p, Object.assign(store.get(p), clone(d))); notify(); },
    delete: async () => { store.delete(p); notify(); },
    acquire: async o => { leases.push(p); return {acquired: true, holder: o.holder}; },
    onSnapshot: next => { const f = () => next(snapDoc(p)); subs.push(f); setTimeout(f, 0); return () => {}; },
  });
  const inColl = c => [...store.keys()].filter(k => k.startsWith(c + '/') && k.split('/').length === c.split('/').length + 1).sort();
  const query = c => {
    const docs = inColl(c).map(snapDoc);
    return {docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {}};
  };
  const collection = c => ({
    path: c, doc: id => doc(c + '/' + id),
    get: async () => query(c),
    onSnapshot: next => { const f = () => next(query(c)); subs.push(f); setTimeout(f, 0); return () => {}; },
  });
  window.__store = store;
  window.__notify = notify;
  window.__saved = [];
  window.claude = {
    use: async n => n === 'db' ? {doc, collection}
      : n === 'downloads' ? {save: async x => { window.__saved.push(x); return {status: 'saved'}; }}
      : null,
  };
})();
