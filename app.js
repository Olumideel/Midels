/* ══════════════════════════════════════════
   REAL BACKEND — SUPABASE INTEGRATION
   Replaces all fake/demo logic with real auth, database, and chat.
   ══════════════════════════════════════════ */

// ── 1. CONFIG — paste your own values here ────────────────────────
const SUPABASE_URL = 'https://sdbgrnixnnybaqhunlmh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYmdybml4bm55YmFxaHVubG1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTAwMzksImV4cCI6MjA5ODQyNjAzOX0.YvvRCpRxLIoC9PxywsuX12E2OgzQIJ2m__aqhSq4Oss';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ──────────────────────────────────────────────────────────
const STATE = {
  currentUser: null,      // { id, name, role, emoji, color, ... } from profiles table
  profiles: [],           // all other users, loaded from DB
  activeChatUserId: null,
  messageChannel: null,   // realtime subscription handle
  friendsPanelTab: 'requests',
};

// ── Init on page load ──────────────────────────────────────────────
async function initBackend() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadCurrentProfile(session.user.id);
  }
  await loadAllProfiles();
  renderChefGrid(STATE.profiles);

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await loadCurrentProfile(session.user.id);
      onLogin();
    }
    if (event === 'SIGNED_OUT') {
      STATE.currentUser = null;
      onLoggedOutUI();
    }
  });
}

async function loadCurrentProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) { console.error(error); return; }
  STATE.currentUser = data;
}

async function loadAllProfiles() {
  const { data, error } = await sb.from('profiles').select('*');
  if (error) { console.error(error); return; }
  STATE.profiles = data.filter(p => !STATE.currentUser || p.id !== STATE.currentUser.id);
}

// ── REAL AUTH ────────────────────────────────────────────────────────
let selectedRole = 'chef';
function selectRole(el, role) {
  document.querySelectorAll('.auth-role').forEach(r => r.classList.remove('on'));
  el.classList.add('on');
  selectedRole = role;
}

async function signupUser() {
  const fname = document.getElementById('auth-fname').value.trim();
  const lname = document.getElementById('auth-lname').value.trim();
  const email = document.getElementById('auth-semail').value.trim();
  const pass  = document.getElementById('auth-spassword').value;

  if (!fname || !email || !pass) { toast('Please fill in required fields', 'error'); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password: pass,
    options: { data: { name: `${fname} ${lname}`.trim(), role: selectedRole } }
  });

  if (error) { toast(error.message, 'error'); return; }

  if (!data.session) {
    toast('Check your email to confirm your account ✉️', 'success');
    closeAuth();
    return;
  }

  await loadCurrentProfile(data.user.id);
  closeAuth();
  await onLogin();
  toast(`Welcome to the Hub, ${fname}! 🎉`, 'success');
}

async function loginUser() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-password').value;
  if (!email || !pass) { toast('Please fill in all fields', 'error'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  if (error) {
    toast(error.message === 'Invalid login credentials' ? 'Incorrect email or password' : error.message, 'error');
    return;
  }

  await loadCurrentProfile(data.user.id);
  closeAuth();
  await onLogin();
  toast(`Welcome back, ${STATE.currentUser.name.split(' ')[0]}! 👋`, 'success');
}

async function logoutUser() {
  await sb.auth.signOut();
  if (STATE.messageChannel) sb.removeChannel(STATE.messageChannel);
  STATE.currentUser = null;
  STATE.activeChatUserId = null;
  closeChat(); closeChatList(); closeFriendsPanel();
  onLoggedOutUI();
  toast('You have been logged out.', '');
}

function onLoggedOutUI() {
  document.getElementById('nav-social-icons').style.display = 'none';
  document.getElementById('nav-login-btn').style.display = '';
  document.getElementById('nav-signup-btn').style.display = '';
  document.getElementById('nav-logout-btn').style.display = 'none';
  renderChefGrid(STATE.profiles);
}

async function onLogin() {
  document.getElementById('nav-social-icons').style.display = 'flex';
  document.getElementById('nav-login-btn').style.display = 'none';
  document.getElementById('nav-signup-btn').style.display = 'none';
  document.getElementById('nav-logout-btn').style.display = '';
  await loadAllProfiles();
  await updateBadges();
  renderChefGrid(STATE.profiles);
  subscribeToMessages();
}

// ── FOLLOW / UNFOLLOW (real DB rows) ─────────────────────────────────
async function toggleFollow(userId) {
  if (!STATE.currentUser) { openAuth('signup'); return; }
  const user = getUser(userId);

  const { data: existing } = await sb.from('follows')
    .select('*').eq('follower_id', STATE.currentUser.id).eq('following_id', userId).maybeSingle();

  if (existing) {
    await sb.from('follows').delete().eq('follower_id', STATE.currentUser.id).eq('following_id', userId);
    toast(`Unfollowed ${user.name}`);
  } else {
    const { error } = await sb.from('follows').insert({ follower_id: STATE.currentUser.id, following_id: userId });
    if (error) { toast(error.message, 'error'); return; }
    toast(`Now following ${user.name} 👏`, 'success');
  }
  renderChefGrid(STATE.profiles);
  renderFollowingPanel();
}

async function getFollowingIds() {
  if (!STATE.currentUser) return new Set();
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', STATE.currentUser.id);
  return new Set((data || []).map(r => r.following_id));
}

// ── FRIEND REQUESTS (real DB rows) ───────────────────────────────────
async function sendFriendRequest(userId) {
  if (!STATE.currentUser) { openAuth('signup'); return; }
  const user = getUser(userId);
  const { error } = await sb.from('friend_requests').insert({
    sender_id: STATE.currentUser.id, receiver_id: userId, status: 'pending'
  });
  if (error) { toast(error.message.includes('duplicate') ? 'Request already sent' : error.message, 'error'); return; }
  toast(`Friend request sent to ${user.name} ✉️`, 'success');
  renderChefGrid(STATE.profiles);
}

async function acceptFriendRequest(requestId, fromId) {
  const { error } = await sb.from('friend_requests').update({ status: 'accepted' }).eq('id', requestId);
  if (error) { toast(error.message, 'error'); return; }
  const user = getUser(fromId);
  toast(`You and ${user.name} are now connected! 🤝`, 'success');
  await updateBadges();
  renderFriendsPanel();
}

async function declineFriendRequest(requestId, fromId) {
  await sb.from('friend_requests').update({ status: 'declined' }).eq('id', requestId);
  const user = getUser(fromId);
  toast(`Request from ${user.name} declined.`);
  await updateBadges();
  renderFriendsPanel();
}

async function withdrawFriendRequest(requestId, toId) {
  await sb.from('friend_requests').delete().eq('id', requestId);
  const user = getUser(toId);
  toast(`Request to ${user.name} withdrawn.`);
  renderFriendsPanel();
}

async function updateBadges() {
  if (!STATE.currentUser) return;
  const { data } = await sb.from('friend_requests')
    .select('id').eq('receiver_id', STATE.currentUser.id).eq('status', 'pending');
  const count = (data || []).length;
  const badge = document.getElementById('req-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function getUser(id) {
  if (STATE.currentUser && id === STATE.currentUser.id) return STATE.currentUser;
  return STATE.profiles.find(u => u.id === id) || {};
}

// ── REAL-TIME CHAT (persisted + live) ────────────────────────────────
async function openChat(userId) {
  if (!STATE.currentUser) { openAuth('signup'); return; }
  const user = getUser(userId);
  STATE.activeChatUserId = userId;

  document.getElementById('chat-with-name').textContent = user.name;
  document.getElementById('chat-av-icon').innerHTML = (user.emoji || '👤') + `<div class="chat-online-dot"></div>`;

  await loadAndRenderMessages(userId);

  await sb.from('messages').update({ read: true })
    .eq('sender_id', userId).eq('receiver_id', STATE.currentUser.id).eq('read', false);

  document.getElementById('chat-panel').classList.add('op');
  closeChatList();
  setTimeout(() => {
    const body = document.getElementById('chat-body');
    body.scrollTop = body.scrollHeight;
  }, 50);
}

async function loadAndRenderMessages(otherUserId) {
  const me = STATE.currentUser.id;
  const { data, error } = await sb.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${me},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${me})`)
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }
  renderChatMessages(data || []);
}

function renderChatMessages(msgs) {
  const body = document.getElementById('chat-body');
  body.innerHTML = msgs.map(m => {
    const isMe = m.sender_id === STATE.currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="chat-msg ${isMe ? 'me' : 'them'}">
      <div class="chat-bubble">${escHTML(m.content)}</div>
      <div class="chat-time">${time}</div>
    </div>`;
  }).join('');
}

async function sendChatMsg() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !STATE.activeChatUserId || !STATE.currentUser) return;

  const { error } = await sb.from('messages').insert({
    sender_id: STATE.currentUser.id,
    receiver_id: STATE.activeChatUserId,
    content: text
  });
  if (error) { toast('Message failed to send', 'error'); return; }

  input.value = '';
  await loadAndRenderMessages(STATE.activeChatUserId);
  const body = document.getElementById('chat-body');
  body.scrollTop = body.scrollHeight;
}

// Subscribe once per login to receive messages live, from anyone, anytime
function subscribeToMessages() {
  if (STATE.messageChannel) sb.removeChannel(STATE.messageChannel);
  STATE.messageChannel = sb.channel('messages-' + STATE.currentUser.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `receiver_id=eq.${STATE.currentUser.id}`
    }, payload => {
      const msg = payload.new;
      if (STATE.activeChatUserId === msg.sender_id && document.getElementById('chat-panel').classList.contains('op')) {
        loadAndRenderMessages(msg.sender_id);
      } else {
        const sender = getUser(msg.sender_id);
        toast(`New message from ${sender.name || 'someone'} 💬`);
        renderChatList();
      }
    })
    .subscribe();
}

function closeChat() {
  document.getElementById('chat-panel').classList.remove('op');
  STATE.activeChatUserId = null;
}
function minimizeChat() {
  document.getElementById('chat-panel').classList.remove('op');
}

async function toggleChatList() {
  const panel = document.getElementById('chat-list-panel');
  const isOpen = panel.classList.contains('op');
  panel.classList.toggle('op', !isOpen);
  if (!isOpen) await renderChatList();
  closeFriendsPanel();
}
function closeChatList() {
  document.getElementById('chat-list-panel').classList.remove('op');
}

async function renderChatList() {
  if (!STATE.currentUser) return;
  const me = STATE.currentUser.id;
  const { data, error } = await sb.from('messages')
    .select('*')
    .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
    .order('created_at', { ascending: false });

  const body = document.getElementById('chat-list-body');
  if (error || !data || !data.length) {
    body.innerHTML = `<div class="panel-empty"><div class="pe-icon">💬</div>No conversations yet</div>`;
    return;
  }

  const seen = new Map();
  for (const m of data) {
    const otherId = m.sender_id === me ? m.receiver_id : m.sender_id;
    if (!seen.has(otherId)) {
      seen.set(otherId, { preview: m.content, time: new Date(m.created_at), unread: 0 });
    }
    if (m.receiver_id === me && !m.read) seen.get(otherId).unread++;
  }

  body.innerHTML = [...seen.entries()].map(([uid, c]) => {
    const u = getUser(uid);
    return `<div class="conv-item" onclick="openChat('${uid}')">
      <div class="conv-av" style="background:${u.color || '#2c5282'}">${u.emoji || '👤'}</div>
      <div class="conv-info">
        <div class="conv-name">${escHTML(u.name || 'Unknown')}</div>
        <div class="conv-preview">${escHTML(c.preview)}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${c.time.toLocaleDateString()}</div>
        ${c.unread > 0 ? `<div class="conv-unread">${c.unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── FRIENDS PANEL (real DB) ───────────────────────────────────────────
async function toggleFriendsPanel(tab) {
  const panel = document.getElementById('friends-panel');
  const isOpen = panel.classList.contains('op');
  if (isOpen && STATE.friendsPanelTab === tab) { closeFriendsPanel(); return; }
  STATE.friendsPanelTab = tab;
  await switchFriendsTab(tab);
  panel.classList.add('op');
  closeChatList();
}
function closeFriendsPanel() {
  document.getElementById('friends-panel').classList.remove('op');
}
async function switchFriendsTab(tab) {
  STATE.friendsPanelTab = tab;
  ['requests','sent','following'].forEach(t => document.getElementById('tab-'+t).classList.toggle('on', t===tab));
  await renderFriendsPanel();
}

async function renderFriendsPanel() {
  const body = document.getElementById('friends-panel-body');
  if (!STATE.currentUser) {
    body.innerHTML = `<div class="panel-empty"><div class="pe-icon">🔒</div>Sign in to see your connections</div>`;
    return;
  }
  const tab = STATE.friendsPanelTab;
  const me = STATE.currentUser.id;

  if (tab === 'requests') {
    const { data } = await sb.from('friend_requests').select('*').eq('receiver_id', me).eq('status', 'pending');
    if (!data || !data.length) { body.innerHTML = `<div class="panel-empty"><div class="pe-icon">👐</div>No pending requests</div>`; return; }
    body.innerHTML = data.map(r => {
      const u = getUser(r.sender_id);
      return `<div class="friend-req">
        <div class="freq-av" style="background:${u.color||'#2c5282'}">${u.emoji||'👤'}</div>
        <div class="freq-info">
          <div class="freq-name">${escHTML(u.name||'Unknown')}</div>
          <div class="freq-meta">${u.role||''} · ${u.location||''}</div>
          <div class="freq-btns">
            <button class="freq-btn accept" onclick="acceptFriendRequest('${r.id}','${r.sender_id}')">Accept</button>
            <button class="freq-btn decline" onclick="declineFriendRequest('${r.id}','${r.sender_id}')">Decline</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } else if (tab === 'sent') {
    const { data } = await sb.from('friend_requests').select('*').eq('sender_id', me).eq('status', 'pending');
    if (!data || !data.length) { body.innerHTML = `<div class="panel-empty"><div class="pe-icon">📤</div>No sent requests</div>`; return; }
    body.innerHTML = data.map(r => {
      const u = getUser(r.receiver_id);
      return `<div class="friend-req">
        <div class="freq-av" style="background:${u.color||'#2c5282'}">${u.emoji||'👤'}</div>
        <div class="freq-info">
          <div class="freq-name">${escHTML(u.name||'Unknown')}</div>
          <div class="freq-meta">${u.role||''} · ${u.location||''}</div>
          <div class="freq-btns"><button class="freq-btn withdraw" onclick="withdrawFriendRequest('${r.id}','${r.receiver_id}')">Withdraw</button></div>
        </div>
      </div>`;
    }).join('');
  } else if (tab === 'following') {
    await renderFollowingPanel();
  }
}

async function renderFollowingPanel() {
  const body = document.getElementById('friends-panel-body');
  if (!STATE.currentUser) return;
  const followingIds = await getFollowingIds();
  if (!followingIds.size) { body.innerHTML = `<div class="panel-empty"><div class="pe-icon">❤️</div>Follow chefs to see them here</div>`; return; }
  body.innerHTML = [...followingIds].map(uid => {
    const u = getUser(uid);
    return `<div class="following-item">
      <div class="fi-av" style="background:${u.color||'#2c5282'}">${u.emoji||'👤'}</div>
      <div class="fi-info">
        <div class="fi-name">${escHTML(u.name||'Unknown')}</div>
        <div class="fi-role">${u.role||''} · ${u.location||''}</div>
      </div>
      <button class="fi-unfollow" onclick="toggleFollow('${uid}')">Unfollow</button>
    </div>`;
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────────────
function escHTML(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function toast(msg, type) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', initBackend);
/* ══════════════════════════════════════════
   CHEF GRID RENDERING — adapted for real DB data
   Append this to supabase-backend.js or include after it.
   ══════════════════════════════════════════ */

let currentChefFilter = 'all';

function filterChefs(role, btnEl) {
  currentChefFilter = role;
  document.querySelectorAll('.chef-fb').forEach(b => b.classList.remove('on'));
  if (btnEl) btnEl.classList.add('on');
  const filtered = role === 'all' ? STATE.profiles : STATE.profiles.filter(p => p.role === role);
  renderChefGrid(filtered);
}

async function renderChefGrid(profiles) {
  const grid = document.getElementById('chef-grid');
  if (!grid) return;

  if (!profiles.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--muted);">No chefs found in this category yet.</div>`;
    return;
  }

  let followingIds = new Set();
  let friendIds = new Set();
  let sentIds = new Set();
  let receivedIds = new Map();

  if (STATE.currentUser) {
    const me = STATE.currentUser.id;
    const [{ data: follows }, { data: reqsSent }, { data: reqsReceived }] = await Promise.all([
      sb.from('follows').select('following_id').eq('follower_id', me),
      sb.from('friend_requests').select('id,receiver_id,status').eq('sender_id', me),
      sb.from('friend_requests').select('id,sender_id,status').eq('receiver_id', me),
    ]);
    followingIds = new Set((follows || []).map(f => f.following_id));
    (reqsSent || []).forEach(r => {
      if (r.status === 'accepted') friendIds.add(r.receiver_id);
      else if (r.status === 'pending') sentIds.add(r.receiver_id);
    });
    (reqsReceived || []).forEach(r => {
      if (r.status === 'accepted') friendIds.add(r.sender_id);
      else if (r.status === 'pending') receivedIds.set(r.sender_id, r.id);
    });
  }

  grid.innerHTML = profiles.map(u => {
    const isFollowing = followingIds.has(u.id);
    const isFriend = friendIds.has(u.id);
    const isSent = sentIds.has(u.id);
    const isReceived = receivedIds.has(u.id);

    let friendBtn;
    if (isFriend) {
      friendBtn = `<button class="chef-btn friend accepted">✓ Connected</button>`;
    } else if (isSent) {
      friendBtn = `<button class="chef-btn friend pending">Pending…</button>`;
    } else if (isReceived) {
      friendBtn = `<button class="chef-btn friend" onclick="acceptFriendRequest('${receivedIds.get(u.id)}','${u.id}')">Accept request</button>`;
    } else {
      friendBtn = `<button class="chef-btn friend" onclick="sendFriendRequest('${u.id}')">Add friend</button>`;
    }

    return `<div class="chef-card">
      <div class="chef-card-top">
        <div class="chef-avatar" style="background:${u.color || '#2c5282'}">${u.emoji || '👤'}</div>
        <div class="chef-info">
          <div class="chef-name">${escHTML(u.name)}</div>
          <div class="chef-role">${(u.role||'').replace('-', ' ')}</div>
          <div class="chef-location">📍 ${escHTML(u.location || 'Location not set')}</div>
        </div>
      </div>
      <div class="chef-tags">${(u.bio ? [u.bio.slice(0,40)] : []).map(t => `<span class="chef-chip">${escHTML(t)}</span>`).join('')}</div>
      <div class="chef-actions">
        <button class="chef-btn follow ${isFollowing?'following':''}" onclick="toggleFollow('${u.id}')">${isFollowing ? '✓ Following' : 'Follow'}</button>
        ${friendBtn}
        <button class="chef-btn msg" onclick="openChat('${u.id}')" title="Message">💬</button>
      </div>
    </div>`;
  }).join('');
}
