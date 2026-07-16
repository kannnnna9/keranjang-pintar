/* Wrapper IndexedDB minimal untuk foto rak (F2 store 'kp_photos').
   Degrade diam: kegagalan storage tidak boleh menghentikan alur belanja. */
(function (root) {
  'use strict';
  var DB_NAME = 'kp_db';
  var STORE = 'kp_photos';
  var VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        if (!root.indexedDB) return resolve(null);
        var req = root.indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
            store.createIndex('expiresAt', 'expiresAt', { unique: false });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }

  function request(mode, operation) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, mode);
          var result = operation(tx.objectStore(STORE));
          tx.oncomplete = function () { resolve(result && 'result' in result ? result.result : result); };
          tx.onerror = function () { resolve(null); };
          tx.onabort = function () { resolve(null); };
        } catch (_) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function putPhoto(record) { return request('readwrite', function (store) { return store.put(record); }); }
  function getPhoto(id) { return request('readonly', function (store) { return store.get(id); }); }
  function deletePhoto(id) { return request('readwrite', function (store) { return store.delete(id); }); }
  function deleteBySession(sessionId) {
    return getPhotosBySession(sessionId).then(function (records) {
      return Promise.all(records.map(function (record) { return deletePhoto(record.id); })).then(function () { return records.length; });
    }).catch(function () { return 0; });
  }

  function getAllPhotos() {
    return openDB().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        try {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { resolve([]); };
        } catch (_) { resolve([]); }
      });
    }).catch(function () { return []; });
  }

  function getPhotosBySession(sessionId) {
    return getAllPhotos().then(function (records) {
      return records.filter(function (record) { return record.sessionId === sessionId; });
    }).catch(function () { return []; });
  }

  root.PhotoDB = {
    openDB: openDB,
    putPhoto: putPhoto,
    getPhoto: getPhoto,
    getPhotosBySession: getPhotosBySession,
    getAllPhotos: getAllPhotos,
    deletePhoto: deletePhoto,
    deleteBySession: deleteBySession,
  };
})(typeof self !== 'undefined' ? self : this);
