// Supabase Setup
const SUPABASE_URL = 'https://zkuwkyfofloayoeoyyej.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_uL7Gr0GAON_cP2bbSggPFw_3wdu1sTB'; // Replace with your publishable key

// Adapter to persist Supabase session inside Chrome Extension Storage
const chromeStorageAdapter = {
  getItem: (key) => new Promise(resolve => chrome.storage.local.get([key], res => resolve(res[key] || null))),
  setItem: (key, value) => new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve)),
  removeItem: (key) => new Promise(resolve => chrome.storage.local.remove([key], resolve))
};

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: chromeStorageAdapter, persistSession: true }
});

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Check active session
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    showApp();
  } else {
    showLogin();
  }
});

// LOGIN EVENT
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const statusEl = document.getElementById('status');

  statusEl.innerText = "Authenticating...";
  statusEl.style.color = "#94a3b8";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    statusEl.innerText = error.message;
    statusEl.style.color = "#f87171";
  } else {
    currentUser = data.user;
    statusEl.innerText = "";
    showApp();
  }
});

// LOGOUT EVENT
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  currentUser = null;
  showLogin();
});

// SYNC LEAGUE EVENT
document.getElementById('syncBtn').addEventListener('click', async () => {
  const leagueId = document.getElementById('leagueId').value.trim();
  const leagueName = document.getElementById('leagueName').value.trim() || `League ${leagueId}`;
  const statusEl = document.getElementById('status');

  if (!leagueId) {
    statusEl.innerText = "Please enter an ESPN League ID.";
    statusEl.style.color = "#f87171";
    return;
  }

  statusEl.innerText = "Fetching ESPN cookies...";
  statusEl.style.color = "#94a3b8";

  try {
    // 1. Fetch SWID and espn_s2 from active browser cookies for espn.com
    const swidCookie = await chrome.cookies.get({ url: "https://www.espn.com", name: "SWID" });
    const espnS2Cookie = await chrome.cookies.get({ url: "https://www.espn.com", name: "espn_s2" });

    if (!swidCookie || !espnS2Cookie) {
      statusEl.innerText = "ESPN cookies not found. Make sure you are logged into ESPN in Chrome!";
      statusEl.style.color = "#f87171";
      return;
    }

    // 2. Upsert credentials to user_leagues table
    const { error } = await supabaseClient
      .from('user_leagues')
      .upsert({
        user_id: currentUser.id,
        league_id: leagueId,
        league_name: leagueName,
        swid: swidCookie.value,
        espn_s2: espnS2Cookie.value
      }, { onConflict: 'user_id, league_id' });

    if (error) throw error;

    statusEl.innerText = "League synced successfully!";
    statusEl.style.color = "#34d399";
    
    // Clear inputs and refresh list
    document.getElementById('leagueId').value = "";
    document.getElementById('leagueName').value = "";
    loadUserLeagues();

  } catch (err) {
    console.error(err);
    statusEl.innerText = "Error: " + err.message;
    statusEl.style.color = "#f87171";
  }
});

// LOAD USER'S SYNCED LEAGUES
async function loadUserLeagues() {
  const listEl = document.getElementById('leagueList');
  
  const { data: leagues, error } = await supabaseClient
    .from('user_leagues')
    .select('league_id, league_name, created_at')
    .eq('user_id', currentUser.id);

  if (error || !leagues || leagues.length === 0) {
    listEl.innerHTML = '<p style="text-align: center; color: #64748b; margin: 4px 0;">No synced leagues yet.</p>';
    return;
  }

  listEl.innerHTML = leagues.map(l => `
    <div class="league-item">
      <div>
        <strong style="color: #f8fafc;">${l.league_name}</strong>
        <div style="color: #64748b; font-size: 10px;">ID: ${l.league_id}</div>
      </div>
      <span style="color: #34d399; font-size: 10px;">✓ Active</span>
    </div>
  `).join('');
}

function showLogin() {
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('appSection').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');
  document.getElementById('userEmail').innerText = currentUser.email;
  loadUserLeagues();
}