(function () {
  const realFetch = window.fetch.bind(window);
  let cachedClientKey = '';
  let client;
  let account;
  let databases;
  let storage;

  const DEBUG = new URLSearchParams(window.location.search).has('appwriteDebug')
    || window.localStorage?.getItem('appwriteAdapterDebug') === '1';

  function isAppwriteMode() {
    const mode = document.querySelector('input[name="backendMode"]:checked');
    return mode && mode.value === 'appwrite';
  }

  function setting(id) {
    return document.getElementById(id).value.trim();
  }

  function collectionId() {
    // The fixed test client labels this as "Files collection ID", but this
    // Appwrite implementation uses it for the profiles collection ID.
    return setting('awFilesCollectionId') || 'profiles';
  }

  function configure() {
    const endpoint = setting('awEndpoint').replace(/\/$/, '');
    const projectId = setting('awProjectId');
    const key = `${endpoint}|${projectId}`;

    if (key === cachedClientKey && client) {
      return;
    }

    if (!window.Appwrite) {
      throw new Error('Appwrite Web SDK is not loaded. Include the CDN script before this adapter.');
    }

    const { Account, Client, Databases, Storage } = window.Appwrite;
    client = new Client().setEndpoint(endpoint).setProject(projectId);
    account = new Account(client);
    databases = new Databases(client);
    storage = new Storage(client);
    cachedClientKey = key;
  }

  function isAppwriteSdkRequest(url) {
    const endpoint = setting('awEndpoint').replace(/\/$/, '');
    if (!endpoint) return false;

    const requestUrl = new URL(url, window.location.href);
    const endpointUrl = new URL(`${endpoint}/`, window.location.href);
    return requestUrl.origin === endpointUrl.origin
      && requestUrl.pathname.startsWith(endpointUrl.pathname);
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function presentProfile(document) {
    return {
      fullName: document?.fullName || '',
      displayName: document?.displayName || '',
      bio: document?.bio || '',
      role: document?.role || '',
      createdAt: document?.$createdAt || null,
    };
  }

  function presentFile(file) {
    return {
      id: file.$id,
      ownerId: null,
      fileName: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeOriginal,
      uploadedAt: file.$createdAt,
    };
  }

  async function currentProfile(userId) {
    const result = await databases.listDocuments(
      setting('awDatabaseId'),
      collectionId(),
      [window.Appwrite.Query.equal('userId', userId)],
    );

    return result.documents[0] || null;
  }

  function statusFromAppwrite(error) {
    if (error.code === 404) return 404;
    if (error.code === 401 || error.code === 403) return 403;
    return error.code || 500;
  }

  function appwriteErrorType(error) {
    return error?.type || error?.response?.type || '';
  }

  function errorDetails(error) {
    return {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      code: error?.code || 0,
      type: appwriteErrorType(error),
      response: error?.response || null,
    };
  }

  function isSessionAlreadyExists(error) {
    return appwriteErrorType(error) === 'user_session_already_exists'
      || /session.*already exists/i.test(error?.message || '');
  }

  function isGuestSessionError(error) {
    return appwriteErrorType(error) === 'user_session_not_found'
      || appwriteErrorType(error) === 'user_unauthorized'
      || appwriteErrorType(error) === 'general_unauthorized_scope'
      || /missing scope \(account\)|guests/i.test(error?.message || '');
  }

  async function deleteCurrentSessionIfAny() {
    try {
      await account.deleteSession('current');
      return true;
    } catch (error) {
      if (isGuestSessionError(error) || error?.code === 401 || error?.code === 404) {
        return false;
      }
      throw error;
    }
  }

  async function createEmailPasswordSession(email, password) {
    try {
      await account.createEmailPasswordSession(email, password);
    } catch (error) {
      if (!isSessionAlreadyExists(error)) {
        throw error;
      }

      await deleteCurrentSessionIfAny();
      await account.createEmailPasswordSession(email, password);
    }
  }

  async function handleRegister(req) {
    const { email, password } = await req.json();
    await deleteCurrentSessionIfAny();
    const created = await account.create(window.Appwrite.ID.unique(), email, password);
    await createEmailPasswordSession(email, password);
    return json(201, { id: created.$id, email: created.email });
  }

  async function handleLogin(req) {
    const { email, password } = await req.json();
    await createEmailPasswordSession(email, password);
    const user = await account.get();
    return json(200, { id: user.$id, email: user.email });
  }

  async function handleLogout() {
    const hadSession = await deleteCurrentSessionIfAny();
    if (!hadSession) {
      return json(200, { message: 'Already logged out' });
    }
    return json(200, { message: 'Logged out' });
  }

  async function handleMe() {
    const user = await account.get();
    const profile = await currentProfile(user.$id);
    return json(200, {
      id: user.$id,
      email: user.email,
      profile: presentProfile(profile),
    });
  }

  async function handleFiles() {
    const result = await storage.listFiles(setting('awBucketId'));
    return json(200, { files: result.files.map(presentFile) });
  }

  async function handleFileById(fileId) {
    const file = await storage.getFile(setting('awBucketId'), fileId);
    return json(200, { file: presentFile(file) });
  }

  async function handleDownload(fileId) {
    const downloadUrl = storage.getFileDownload(setting('awBucketId'), fileId);
    return realFetch(downloadUrl, { credentials: 'include' });
  }

  async function normalizeError(label, error) {
    if (label === 'login' && isSessionAlreadyExists(error)) {
      return json(409, { error: 'A session already exists. Log out and try again.' });
    }

    if (label === 'login' || label === 'register') {
      if (error.code === 409) {
        return json(409, { error: error.message || 'Account already exists' });
      }

      return json(401, { error: 'Invalid email or password' });
    }

    if (label === 'auth') {
      return json(401, { error: 'Not authenticated' });
    }

    const status = statusFromAppwrite(error);
    if (status === 404) return json(404, { error: 'File not found' });
    if (status === 403) return json(403, { error: 'You do not have access to this file' });
    return json(status, { error: error.message || 'Appwrite request failed' });
  }

  window.fetch = async function appwriteAdapterFetch(input, init) {
    if (!isAppwriteMode()) {
      return realFetch(input, init);
    }

    let pathname = '';
    let req;

    try {
      const url = typeof input === 'string' ? input : input.url;
      if (isAppwriteSdkRequest(url)) {
        return await realFetch(input, init);
      }

      configure();

      req = new Request(input, init);
      ({ pathname } = new URL(url, window.location.href));

      if (pathname === '/register' && req.method === 'POST') return await handleRegister(req);
      if (pathname === '/login' && req.method === 'POST') return await handleLogin(req);
      if (pathname === '/logout' && req.method === 'POST') return await handleLogout();
      if (pathname === '/me' && req.method === 'GET') return await handleMe();
      if (pathname === '/files' && req.method === 'GET') return await handleFiles();

      let match = pathname.match(/^\/files\/([^/]+)\/download$/);
      if (match && req.method === 'GET') return await handleDownload(match[1]);

      match = pathname.match(/^\/files\/([^/]+)$/);
      if (match && req.method === 'GET') return await handleFileById(match[1]);

      return json(404, { error: `No Appwrite adapter route for ${req.method} ${pathname}` });
    } catch (error) {
      if (DEBUG) {
        console.error('Appwrite adapter request failed:', errorDetails(error), error);
      }

      if (pathname === '/login') return normalizeError('login', error);
      if (pathname === '/register') return normalizeError('register', error);
      if (pathname === '/me' || pathname === '/files') return normalizeError('auth', error);
      return normalizeError('file', error);
    }
  };
}());
