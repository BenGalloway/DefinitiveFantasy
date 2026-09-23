'use strict';

// Firefox exposes promise-based browser.*, and modern Chromium MV3 exposes
// promise-based chrome.* for the storage/cookies APIs used here.
const ext = globalThis.browser ?? globalThis.chrome;
const SUPABASE_URL = 'https://zkuwkyfofloayoeoyyej.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_uL7Gr0GAON_cP2bbSggPFw_3wdu1sTB'; // Public key, never a service-role key.

// Persist the Supabase auth session across popup closes (separately in each browser).
const extensionStorage = {
  getItem: async (key) => (await ext.storage.local.get(key))[key] ?? null,
  setItem: (key, value) => ext.storage.local.set({ [key]: value }),
  removeItem: (key) => ext.storage.local.remove(key),
};

const supabaseClient = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: extensionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

let currentUser = null;
const el = (id) => document.getElementById(id);

function setStatus(message, kind = 'neutral') {
  const colors = { neutral: '#94a3b8', error: '#f87171', success: '#34d399' };
  el('status').textContent = message;
  el('status').style.color = colors[kind];
}

function showLogin() {
  el('loginSection').classList.remove('hidden');
  el('appSection').classList.add('hidden');
}

function showApp() {
  el('loginSection').classList.add('hidden');
  el('appSection').classList.remove('hidden');
  el('userEmail').textContent = currentUser.email ?? '';
  void loadUserLeagues();
}

function showListMessage(message) {
  const paragraph = document.createElement('p');
  paragraph.className = 'empty';
  paragraph.textContent = message;
  el('leagueList').replaceChildren(paragraph);
}

async function loadUserLeagues() {
  try {
    const { data: leagues, error } = await supabaseClient
      .from('user_leagues')
      .select('league_id, league_name')
      .eq('user_id', currentUser.id);

    if (error) throw error;
    if (!leagues?.length) {
      showListMessage('No synced leagues yet.');
      return;
    }

    // Do not interpolate a league name into innerHTML: it is user-controlled.
    const fragment = document.createDocumentFragment();
    for (const league of leagues) {
      const row = document.createElement('div');
      row.className = 'league-item';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = league.league_name || `League ${league.league_id}`;
      const id = document.createElement('div');
      id.className = 'league-id';
      id.textContent = `ID: ${league.league_id}`;
      const active = document.createElement('span');
      active.className = 'active';
      active.textContent = '✓ Active';
      details.append(title, id);
      row.append(details, active);
      fragment.append(row);
    }
    el('leagueList').replaceChildren(fragment);
  } catch (error) {
    showListMessage('Could not load leagues.');
    setStatus(`Could not load leagues: ${error.message}`, 'error');
  }
}

async function handleLogin() {
  const email = el('email').value.trim();
  const password = el('password').value; // Never trim a password.
  if (!email || !password) {
    setStatus('Enter your email and password.', 'error');
    return;
  }

  el('loginBtn').disabled = true;
  setStatus('Authenticating...');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data?.user) throw new Error('No account was returned.');
    currentUser = data.user;
    el('password').value = '';
    setStatus('');
    showApp();
  } catch (error) {
    setStatus(`Could not log in: ${error.message}`, 'error');
  } finally {
    el('loginBtn').disabled = false;
  }
}

async function handleLogout() {
  el('logoutBtn').disabled = true;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentUser = null;
    setStatus('Signed out.');
    showLogin();
  } catch (error) {
    setStatus(`Could not log out: ${error.message}`, 'error');
  } finally {
    el('logoutBtn').disabled = false;
  }
}

async function handleSync() {
  const leagueId = el('leagueId').value.trim();
  const leagueName = el('leagueName').value.trim() || `League ${leagueId}`;
  if (!/^\d+$/.test(leagueId)) {
    setStatus('Enter a numeric ESPN League ID.', 'error');
    return;
  }
  if (!currentUser) {
    setStatus('Please sign in first.', 'error');
    return;
  }

  el('syncBtn').disabled = true;
  setStatus('Fetching ESPN cookies...');
  try {
    if (ext.permissions?.contains && !(await ext.permissions.contains({
      origins: ['https://*.espn.com/*'],
    }))) {
      throw new Error('ESPN site access is disabled. Enable it in the extension permissions.');
    }

    // By default, cookies.get searches the normal browser cookie store.
    const url = 'https://www.espn.com/';
    const [swid, espnS2] = await Promise.all([
      ext.cookies.get({ url, name: 'SWID' }),
      ext.cookies.get({ url, name: 'espn_s2' }),
    ]);
    if (!swid || !espnS2) {
      throw new Error('ESPN cookies not found. Log in to ESPN in this browser (normal profile, not a Firefox Container).');
    }

    // This mirrors the original behavior. BEFORE real use, protect these
    // account-level secrets server-side; see README's security warning.
    const { error } = await supabaseClient.from('user_leagues').upsert({
      user_id: currentUser.id,
      league_id: leagueId,
      league_name: leagueName,
      swid: swid.value,
      espn_s2: espnS2.value,
    }, { onConflict: 'user_id,league_id' });
    if (error) throw error;

    el('leagueId').value = '';
    el('leagueName').value = '';
    setStatus('League synced successfully!', 'success');
    await loadUserLeagues();
  } catch (error) {
    setStatus(`Could not sync: ${error.message}`, 'error');
  } finally {
    el('syncBtn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  el('loginBtn').addEventListener('click', handleLogin);
  el('logoutBtn').addEventListener('click', handleLogout);
  el('syncBtn').addEventListener('click', handleSync);

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    currentUser = data?.session?.user ?? null;
    if (currentUser) showApp();
    else showLogin();
  } catch (error) {
    showLogin();
    setStatus(`Could not restore your session: ${error.message}`, 'error');
  }
});
