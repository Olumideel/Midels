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
  isPlatformAdmin: false, // independent platform permission, not a public profile role
  profiles: [],           // all other users, loaded from DB
  activeChatUserId: null,
  activeConversationId: null,
  messageChannel: null,   // realtime subscription handle
  friendsPanelTab: 'requests',
};

// ── Init on page load ──────────────────────────────────────────────
function normalizeProfile(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    name: profile.name || profile.display_name || profile.full_name || 'Member',
    location: [profile.city, profile.country_code].filter(Boolean).join(', ')
  };
}

async function initBackend() {
  // Auth handlers below own the SIGNED_IN UI transition, preventing duplicate
  // profile loads and duplicate realtime subscriptions.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      STATE.currentUser = null;
      if (STATE.messageChannel) {
        sb.removeChannel(STATE.messageChannel);
        STATE.messageChannel = null;
      }
      onLoggedOutUI();
    } else if (event === 'PASSWORD_RECOVERY') {
      showPasswordRecoveryForm();
    }
  });

  const { data: { session }, error } = await sb.auth.getSession();
  if (error) console.error('Unable to restore session:', error);

  if (session) {
    const profile = await loadCurrentProfile(session.user.id);
    if (profile) {
      await onLogin();
      return;
    }
    toast('Your account is signed in, but its profile could not be loaded. Please contact support.', 'error');
  }

  await loadAllProfiles();
  renderChefGrid(STATE.profiles);
  await loadPublicRecipes();
  await loadPlatformStats();
  await loadLearningDashboard();
  await loadMarketplace();
}

async function loadCurrentProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) {
    console.error('Unable to load current profile:', error);
    STATE.currentUser = null;
    return null;
  }
  STATE.currentUser = normalizeProfile(data);
  return STATE.currentUser;
}

async function loadAllProfiles() {
  const { data, error } = await sb.from('profiles').select('*');
  if (error) {
    console.error('Unable to load profiles:', error);
    return;
  }
  STATE.profiles = (data || [])
    .map(normalizeProfile)
    .filter(p => !STATE.currentUser || p.id !== STATE.currentUser.id);
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
  if (pass.length < 12 || !/[a-z]/.test(pass) || !/[A-Z]/.test(pass) || !/\\d/.test(pass) || !/[^A-Za-z0-9]/.test(pass)) { toast('Use at least 12 characters with uppercase, lowercase, a number and a symbol.', 'error'); return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password: pass,
    options: { emailRedirectTo: 'https://olumideel.github.io/Midels/', data: { name: `${fname} ${lname}`.trim(), full_name: `${fname} ${lname}`.trim(), display_name: `${fname} ${lname}`.trim(), role: selectedRole, requested_role: selectedRole } }
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

  const profile = await loadCurrentProfile(data.user.id);
  if (!profile) {
    toast('Signed in, but your profile could not be loaded. Please try again or contact support.', 'error');
    return;
  }

  closeAuth();
  await onLogin();
  const firstName = (profile.name || profile.display_name || profile.full_name || 'there').trim().split(/\s+/)[0];
  toast(`Welcome back, ${firstName}! 👋`, 'success');
}

async function sendPasswordResetEmail() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) {
    toast('Enter your account email address first.', 'error');
    document.getElementById('auth-email').focus();
    return;
  }

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://olumideel.github.io/Midels/'
  });

  if (error) {
    toast(error.message, 'error');
    return;
  }
  toast('If an account exists for that email, a password recovery link has been sent. Check your inbox and spam folder.', 'success');
}

function showPasswordRecoveryForm() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.add('op');
  document.querySelector('.auth-tabs').style.display = 'none';
  document.getElementById('auth-login-form').style.display = 'none';
  document.getElementById('auth-signup-form').style.display = 'none';
  document.getElementById('auth-recovery-form').style.display = '';
  document.getElementById('auth-title').textContent = 'Reset your password';
  document.getElementById('auth-sub').textContent = 'Choose a new password for your account';
}

async function updateRecoveredPassword() {
  const password = document.getElementById('auth-new-password').value;
  const confirm = document.getElementById('auth-confirm-password').value;
  if (!password || password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    toast('Use at least 12 characters with uppercase, lowercase, a number and a symbol.', 'error');
    return;
  }
  if (password !== confirm) {
    toast('The passwords do not match.', 'error');
    return;
  }

  const { data, error } = await sb.auth.updateUser({ password });
  if (error) {
    toast(error.message, 'error');
    return;
  }

  const profile = await loadCurrentProfile(data.user.id);
  if (profile) {
    closeAuth();
    await onLogin();
    toast('Your password has been updated. Welcome back!', 'success');
  } else {
    toast('Password updated, but your profile could not be loaded. Please sign in again.', 'error');
    await sb.auth.signOut();
    switchAuthTab('login');
  }
}

async function logoutUser() {
  await sb.auth.signOut();
  if (STATE.messageChannel) sb.removeChannel(STATE.messageChannel);
  STATE.currentUser = null;
  STATE.isPlatformAdmin = false;
  STATE.activeChatUserId = null;
  closeChat(); closeChatList(); closeFriendsPanel();
  onLoggedOutUI();
  toast('You have been logged out.', '');
}


async function refreshPlatformAdminAccess() {
  STATE.isPlatformAdmin = false;
  if (!STATE.currentUser?.id) { syncAdminNavigation(); return; }
  try {
    const { data, error } = await sb.rpc('current_user_is_platform_admin');
    if (error) throw error;
    STATE.isPlatformAdmin = data === true;
  } catch (error) {
    console.error('Unable to check platform administrator access:', error);
  }
  syncAdminNavigation();
}

function syncAdminNavigation() {
  const button = document.getElementById('nav-admin-btn');
  const panel = document.getElementById('admin-console');
  const isAdmin = STATE.isPlatformAdmin === true;
  if (button) button.style.display = isAdmin ? 'inline-flex' : 'none';
  if (!isAdmin && panel) panel.style.display = 'none';
}
function onLoggedOutUI() {
  syncAdminNavigation();
  document.getElementById('nav-social-icons').style.display = 'none';
  document.getElementById('mobile-profile-link').style.display = 'none';
  document.getElementById('nav-login-btn').style.display = '';
  document.getElementById('nav-signup-btn').style.display = '';
  document.getElementById('nav-logout-btn').style.display = 'none';
  renderChefGrid(STATE.profiles);
}

async function onLogin() {
  await refreshPlatformAdminAccess();
  syncAdminNavigation();
  document.getElementById('nav-social-icons').style.display = 'flex';
  document.getElementById('mobile-profile-link').style.display = 'block';
  document.getElementById('nav-login-btn').style.display = 'none';
  document.getElementById('nav-signup-btn').style.display = 'none';
  document.getElementById('nav-logout-btn').style.display = '';
  await loadAllProfiles();
  await updateBadges();
  renderChefGrid(STATE.profiles);
  await loadPublicRecipes();
  await loadPlatformStats();
  await loadLearningDashboard();
  await loadMarketplace();
  subscribeToMessages();
  await handlePaymentReturn();
}

async function handlePaymentReturn() {
  if (!STATE.currentUser) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('payment') !== 'return') return;
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref');
  if (!reference) {
    toast('Payment return received, but no reference was provided. Check your payment history.', 'error');
    url.searchParams.delete('payment');
    window.history.replaceState({}, '', url.toString());
    return;
  }

  toast('Verifying your payment securely…');
  try {
    const { data, error } = await sb.functions.invoke('verify-payment', {
      body: { reference }
    });
    if (error) throw error;
    if (data?.verified && data.status === 'paid') {
      if (data.purpose === 'product_purchase') {
        toast('Payment verified. Your digital product is ready in My purchases.', 'success');
        await loadMarketplace();
      } else if (data.purpose === 'course_enrollment') {
        toast('Payment verified. You are now enrolled in the course.', 'success');
        await loadLearningDashboard();
      } else {
        toast('Payment verified. Your subscription is now active.', 'success');
      }
    } else {
      toast('Your payment is not confirmed yet. We will not activate access until Paystack verifies it.', 'error');
    }
  } catch (error) {
    console.error('Payment return verification failed:', error);
    toast('We could not verify the payment just yet. Please refresh your account shortly.', 'error');
  } finally {
    url.searchParams.delete('payment');
    url.searchParams.delete('reference');
    url.searchParams.delete('trxref');
    window.history.replaceState({}, '', url.toString());
  }
}


async function reportCommunityContent(targetType, targetId) {
  if (!STATE.currentUser) { openAuth('login'); toast('Sign in before reporting content.'); return; }
  if (!['recipe','profile'].includes(targetType) || !targetId) { toast('This item cannot be reported right now.', 'error'); return; }
  const reason = window.prompt('Why are you reporting this? Enter one: Spam, Harassment, Hate or discrimination, Copyright, Unsafe or misleading, Other');
  if (!reason || !reason.trim()) return;
  const allowed = ['spam','harassment','hate or discrimination','copyright','unsafe or misleading','other'];
  if (!allowed.includes(reason.trim().toLowerCase())) { toast('Please use one of the listed report reasons.', 'error'); return; }
  const details = window.prompt('Add helpful context (optional, maximum 1000 characters):') || '';
  if (details.length > 1000) { toast('Report details must be 1,000 characters or fewer.', 'error'); return; }
  try {
    const { data: existing, error: lookupError } = await sb.from('content_reports').select('id')
      .eq('reporter_id', STATE.currentUser.id).eq('target_type', targetType).eq('target_id', targetId)
      .in('status', ['open','reviewing']).limit(1);
    if (lookupError) throw lookupError;
    if (existing?.length) { toast('You already have an open report for this item.'); return; }
    const { error } = await sb.from('content_reports').insert({
      reporter_id: STATE.currentUser.id, target_type: targetType, target_id: targetId,
      reason: reason.trim(), details: details.trim() || null
    });
    if (error) throw error;
    toast('Report submitted. Thank you for helping keep the community safe.', 'success');
  } catch (error) {
    console.error('Report submission failed:', error);
    toast('We could not submit this report. Please try again later.', 'error');
  }
}
async function openAdminConsole() {
  if (!STATE.isPlatformAdmin) { toast('Administrator access required.', 'error'); return; }
  const panel = document.getElementById('admin-console');
  if (!panel) return;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await Promise.all([loadAdminReports(), loadAdminMetrics(), loadAdminPrivacyRequests()]);
}
async function loadAdminMetrics() {
  if (!STATE.isPlatformAdmin) return;
  const el = document.getElementById('admin-metrics');
  if (!el) return;
  el.textContent = 'Loading platform metrics…';
  const { data, error } = await sb.rpc('admin_get_platform_metrics');
  if (error || !data) {
    console.error('Platform metrics unavailable:', error);
    el.textContent = 'Platform metrics could not be loaded.';
    return;
  }
  const fields = [
    ['Active members', data.active_members],
    ['Active chefs', data.active_chefs],
    ['Published recipes', data.published_recipes],
    ['Published courses', data.published_courses],
    ['Active enrolments', data.active_enrolments],
    ['Published products', data.published_products],
    ['Paid transactions', data.paid_transactions],
    ['Refunded transactions', data.refunded_transactions],
    ['Open reports', data.open_reports]
  ];
  const revenue = (data.revenue_by_currency || []).map(x => x.currency + ': ' + (Number(x.amount_minor || 0) / 100).toFixed(2)).join(' · ') || 'No paid transactions recorded';
  el.textContent = fields.map(x => x[0] + ': ' + Number(x[1] || 0).toLocaleString()).join(' | ') + ' | Paid revenue: ' + revenue + ' | Updated: ' + new Date(data.generated_at).toLocaleString();
}


async function loadAdminPrivacyRequests() {
  if (!STATE.isPlatformAdmin) return;
  const list = document.getElementById('admin-privacy-list');
  if (!list) return;
  const status = document.getElementById('admin-privacy-status')?.value || 'open';
  list.textContent = 'Loading privacy requests…';
  const { data, error } = await sb.rpc('admin_list_privacy_requests', { p_status: status });
  if (error) {
    console.error('Admin privacy queue failed:', error);
    list.textContent = 'Unable to load privacy requests.';
    return;
  }
  if (!data?.length) { list.textContent = 'No privacy requests in this queue.'; return; }
  list.innerHTML = data.map(item => {
    const label = item.request_type === 'data_deletion' ? 'Account deletion request' : 'Personal data access/export request';
    const actions = item.status === 'open'
      ? '<button class="btn bo" type="button" onclick="updateAdminPrivacyRequest(\'' + escHTML(item.id) + '\',\'reviewing\')">Mark reviewing</button>' : '';
    const finalActions = ['fulfilled','rejected'].includes(item.status) ? ''
      : '<button class="btn bp" type="button" onclick="updateAdminPrivacyRequest(\'' + escHTML(item.id) + '\',\'fulfilled\')">Mark fulfilled</button><button class="btn ghost" type="button" onclick="updateAdminPrivacyRequest(\'' + escHTML(item.id) + '\',\'rejected\')">Reject</button>';
    return '<article style="padding:16px 0;border-bottom:1px solid var(--border);">' +
      '<strong>' + label + '</strong><p style="font-size:13px;color:var(--muted);margin:6px 0;">' +
      escHTML(item.display_name || 'Member') + ' · ' + escHTML(item.email || '') + ' · ' +
      escHTML(item.status) + ' · ' + new Date(item.created_at).toLocaleString() + '</p>' +
      (item.details ? '<p style="margin:8px 0;">' + escHTML(item.details) + '</p>' : '') +
      '<div class="profile-actions" style="justify-content:flex-start;margin-top:10px;">' + actions + finalActions + '</div></article>';
  }).join('');
}

async function updateAdminPrivacyRequest(requestId, status) {
  if (!STATE.isPlatformAdmin) return;
  const { data, error } = await sb.rpc('admin_update_privacy_request', {
    p_request_id: requestId, p_status: status
  });
  if (error || data !== true) {
    console.error('Privacy request update failed:', error);
    toast('The privacy request could not be updated.', 'error');
    return;
  }
  toast('Privacy request status updated.', 'success');
  await loadAdminPrivacyRequests();
}

async function loadAdminReports() {
  if (!STATE.isPlatformAdmin) return;
  const status = document.getElementById('admin-report-status')?.value || 'open';
  const list = document.getElementById('admin-report-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--muted);padding:16px 0;">Loading reports…</p>';
  const { data, error } = await sb.rpc('admin_list_content_reports', { p_status: status });
  if (error) {
    console.error('Admin report load failed:', error);
    list.innerHTML = '<p style="color:var(--red);padding:16px 0;">Unable to load reports. Confirm administrator access and try again.</p>';
    return;
  }
  if (!data?.length) { list.innerHTML = '<p style="color:var(--muted);padding:16px 0;">No reports in this queue.</p>'; return; }
  list.innerHTML = data.map(report => {
    const actions = report.status === 'open'
      ? '<button class="btn bo" type="button" onclick="updateAdminReport(\'' + escHTML(report.id) + '\',\'reviewing\')">Mark reviewing</button>' : '';
    const closeActions = ['resolved','dismissed'].includes(report.status) ? ''
      : '<button class="btn bp" type="button" onclick="updateAdminReport(\'' + escHTML(report.id) + '\',\'resolved\')">Resolve</button><button class="btn ghost" type="button" onclick="updateAdminReport(\'' + escHTML(report.id) + '\',\'dismissed\')">Dismiss</button>';
    return '<article style="padding:18px 0;border-bottom:1px solid var(--border);">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><strong>' +
      escHTML(report.target_type) + ' report · ' + escHTML(report.reason) + '</strong><span class="chef-chip">' + escHTML(report.status) + '</span></div>' +
      '<p style="color:var(--muted);font-size:13px;margin:8px 0;">Reported by ' + escHTML(report.reporter_name || 'Member') + ' · ' + new Date(report.created_at).toLocaleString() + '</p>' +
      (report.details ? '<p style="margin:8px 0;line-height:1.6;">' + escHTML(report.details) + '</p>' : '') +
      '<p style="font-size:12px;color:var(--muted);word-break:break-all;">Target ID: ' + escHTML(report.target_id) + '</p>' +
      '<div class="profile-actions" style="justify-content:flex-start;margin-top:12px;">' + actions + closeActions + '</div></article>';
  }).join('');
}

async function loadMyPrivacyRequests() {
  const box = document.getElementById('my-privacy-requests');
  if (!box || !STATE.currentUser?.id) return;
  box.textContent = 'Loading your requests…';
  const { data, error } = await sb.from('privacy_requests')
    .select('request_type,status,created_at,resolved_at')
    .eq('user_id', STATE.currentUser.id)
    .order('created_at', { ascending: false }).limit(10);
  if (error) {
    console.error('Privacy requests load failed:', error);
    box.textContent = 'Your request history is temporarily unavailable.';
    return;
  }
  if (!data?.length) { box.textContent = 'You have not submitted a privacy request.'; return; }
  box.textContent = data.map(item => {
    const label = item.request_type === 'data_deletion' ? 'Account deletion' : 'Data copy';
    return label + ' · ' + item.status + ' · ' + new Date(item.created_at).toLocaleDateString();
  }).join('\n');
}

async function submitPrivacyRequest(requestType) {
  if (!STATE.currentUser?.id || !['data_access','data_deletion'].includes(requestType)) return;
  if (requestType === 'data_deletion') {
    const confirm = window.prompt('This submits a deletion request for manual review; it does not immediately delete your account. Type DELETE to continue:');
    if (confirm !== 'DELETE') return;
  }
  const details = window.prompt('Add any details that will help us process your request (optional, maximum 1,000 characters):') || '';
  if (details.length > 1000) { toast('Details must be 1,000 characters or fewer.', 'error'); return; }
  const { error } = await sb.from('privacy_requests').insert({
    user_id: STATE.currentUser.id,
    request_type: requestType,
    details: details.trim() || null
  });
  if (error) {
    console.error('Privacy request submission failed:', error);
    toast(error.code === '23505' ? 'You already have an open request of this type.' : 'We could not submit your request. Please try again later.', 'error');
    return;
  }
  toast('Your privacy request has been submitted for review.', 'success');
  await loadMyPrivacyRequests();
}

async function updateAdminReport(reportId, status) {
  if (!STATE.isPlatformAdmin) return;
  const { data, error } = await sb.rpc('admin_update_content_report', { p_report_id: reportId, p_status: status });
  if (error || data !== true) { console.error('Report update failed:', error); toast('The report status could not be updated.', 'error'); return; }
  toast('Report status updated.', 'success');
  await loadAdminReports();
}

// ── PUBLIC CHEF / CREATOR PROFILES ────────────────────────────────
function safeProfileLink(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

async function openPublicProfile(userId) {
  const user = getUser(userId);
  if (!user?.id) return;
  const modal = document.getElementById('public-profile-modal');
  const content = document.getElementById('public-profile-content');
  const website = safeProfileLink(user.website_url);
  const instagram = safeProfileLink(user.instagram_url);
  const role = (user.role || 'food-lover').replace(/-/g, ' ');
  const location = user.location || 'Location not added';
  const verified = user.is_verified ? '<span class="chef-chip">✓ Verified</span>' : '';

  content.innerHTML =
    '<div class="profile-heading">' +
      avatarMarkup(user, 'profile-avatar') +
      '<div><div class="profile-kicker">GLOBAL CULINARY HUB MEMBER</div>' +
      '<h2>' + escHTML(user.name || 'Community member') + '</h2>' +
      '<p>' + escHTML(role) + ' · ' + escHTML(location) + '</p>' + verified + '</div>' +
    '</div>' +
    '<p style="line-height:1.7;color:var(--muted);margin-bottom:18px;">' +
      escHTML(user.bio || 'This member has not added a biography yet.') + '</p>' +
    '<div class="profile-form-grid">' +
      '<div><strong>' + Number(user.followers_count || 0).toLocaleString() + '</strong><p>Followers</p></div>' +
      '<div><strong>' + Number(user.recipes_count || 0).toLocaleString() + '</strong><p>Recipes shared</p></div>' +
    '</div>' +
    '<div class="profile-actions" style="justify-content:flex-start;flex-wrap:wrap;">' +
      '<button class="btn bp" onclick="toggleFollow(\'' + escHTML(user.id) + '\')">Follow</button>' +
      '<button class="btn ghost" onclick="closePublicProfile();openChat(\'' + escHTML(user.id) + '\')">Message</button>' +
      (STATE.currentUser && STATE.currentUser.id !== user.id ? '<button class="btn ghost" onclick="reportCommunityContent(\'profile\',\'' + escHTML(user.id) + '\')">Report profile</button>' : '') +
      (website ? '<a class="btn ghost" href="' + escHTML(website) + '" target="_blank" rel="noopener noreferrer">Website ↗</a>' : '') +
      (instagram ? '<a class="btn ghost" href="' + escHTML(instagram) + '" target="_blank" rel="noopener noreferrer">Instagram ↗</a>' : '') +
    '</div>' +
    '<div style="margin-top:24px;"><h3 style="font:20px var(--display);margin-bottom:12px;">Recent recipes</h3><div id="public-profile-recipes" class="profile-recipe-list">Loading…</div></div>';

  modal.classList.add('op');
  const { data: recipes, error } = await sb.from('recipes')
    .select('id,title,cuisine,difficulty')
    .eq('author_id', userId)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(4);
  const recipeList = document.getElementById('public-profile-recipes');
  if (!recipeList || !modal.classList.contains('op')) return;
  if (error || !recipes?.length) {
    recipeList.textContent = 'No published recipes yet.';
    return;
  }
  recipeList.innerHTML = recipes.map(recipe =>
    '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
      '<strong>' + escHTML(recipe.title) + '</strong>' +
      '<span style="color:var(--muted);font-size:12px;"> · ' +
      escHTML(recipe.cuisine || 'Cuisine not listed') + '</span></div>'
  ).join('');
}

function closePublicProfile() {
  document.getElementById('public-profile-modal')?.classList.remove('op');
}

// ── RECIPE COMPOSER ────────────────────────────────────────────────
function openRecipeComposer() {
  if (!STATE.currentUser) {
    openAuth('signup');
    toast('Sign in or create an account to publish a recipe.');
    return;
  }
  editingRecipeId = null;
  document.getElementById('recipe-form').reset();
  document.getElementById('recipe-form-title').textContent = 'Share a dish with the world';
  document.getElementById('recipe-submit').textContent = 'Publish recipe';
  showRecipePhotoPreview('');
  document.getElementById('recipe-modal').classList.add('op');
}
function closeRecipeComposer() {
  document.getElementById('recipe-modal')?.classList.remove('op');
}
let editingRecipeId = null;

function openRecipeEditor(recipeId) {
  const recipe = liveRecipes.find(item => String(item.id) === String(recipeId));
  if (!recipe || !STATE.currentUser || recipe.author_id !== STATE.currentUser.id) {
    toast('You can only edit recipes you shared.', 'error');
    return;
  }
  editingRecipeId = recipe.id;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; };
  set('recipe-title', recipe.title);
  set('recipe-cuisine', recipe.cuisine);
  set('recipe-difficulty', recipe.difficulty || 'Easy');
  set('recipe-category', recipe.category);
  set('recipe-prep', recipe.prep_minutes || 0);
  set('recipe-cook', recipe.cook_minutes || 0);
  set('recipe-servings', recipe.servings || 2);
  set('recipe-image', recipe.image_url || '');
  set('recipe-description', recipe.description || '');
  set('recipe-ingredients', Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : '');
  set('recipe-instructions', Array.isArray(recipe.instructions) ? recipe.instructions.join('\n') : '');
  set('recipe-tags', Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '');
  document.getElementById('recipe-photo-file').value = '';
  showRecipePhotoPreview(recipe.image_url || '');
  document.getElementById('recipe-form-title').textContent = 'Edit your recipe';
  document.getElementById('recipe-submit').textContent = 'Save recipe changes';
  closeRecipeDetail();
  document.getElementById('recipe-modal').classList.add('op');
}

function previewRecipePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    event.target.value = '';
    toast('Choose a JPG, PNG or WEBP food photograph.', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    event.target.value = '';
    toast('Food photographs must be 8 MB or smaller.', 'error');
    return;
  }
  showRecipePhotoPreview(URL.createObjectURL(file));
}

function showRecipePhotoPreview(url) {
  const preview = document.getElementById('recipe-photo-preview');
  if (!preview) return;
  preview.innerHTML = url
    ? '<img src="' + escHTML(url) + '" alt="Food photograph preview"><span>Food photo preview</span>'
    : '<span>🍽️ Your food photograph will appear here</span>';
}

function closeRecipeComposer() {
  document.getElementById('recipe-modal')?.classList.remove('op');
  editingRecipeId = null;
}

async function submitRecipe(event) {
  event.preventDefault();
  const wasEditing = Boolean(editingRecipeId);
  if (!STATE.currentUser) {
    closeRecipeComposer();
    openAuth('login');
    return;
  }

  const title = document.getElementById('recipe-title').value.trim();
  const ingredients = document.getElementById('recipe-ingredients').value.split('\n').map(line => line.trim()).filter(Boolean);
  const instructions = document.getElementById('recipe-instructions').value.split('\n').map(line => line.trim()).filter(Boolean);
  const imageInput = document.getElementById('recipe-image').value.trim();
  const photoFile = document.getElementById('recipe-photo-file').files?.[0] || null;
  if (!title || !ingredients.length || !instructions.length) {
    toast('Add a title, ingredients and cooking instructions.', 'error');
    return;
  }
  let imageUrl = imageInput ? null : (editingRecipeId ? (liveRecipes.find(r => r.id === editingRecipeId)?.image_url || null) : null);
  if (imageInput) {
    try {
      const parsed = new URL(imageInput);
      if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
      imageUrl = parsed.href;
    } catch {
      toast('Food photo links must be valid HTTPS URLs.', 'error');
      return;
    }
  }
  if (photoFile && (!['image/jpeg', 'image/png', 'image/webp'].includes(photoFile.type) || photoFile.size > 8 * 1024 * 1024)) {
    toast('Choose a JPG, PNG or WEBP image up to 8 MB.', 'error');
    return;
  }

  const integerValue = id => {
    const value = Number(document.getElementById(id).value);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  };
  const tags = document.getElementById('recipe-tags').value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const recipeId = editingRecipeId || (crypto.randomUUID ? crypto.randomUUID() : null);
  if (!recipeId) {
    toast('This browser cannot create a secure recipe identifier. Please update your browser.', 'error');
    return;
  }
  const button = document.getElementById('recipe-submit');
  const originalLabel = editingRecipeId ? 'Save recipe changes' : 'Publish recipe';
  button.disabled = true;
  button.textContent = photoFile ? 'Uploading food photo…' : (editingRecipeId ? 'Saving changes…' : 'Publishing…');

  if (photoFile) {
    const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[photoFile.type];
    const photoPath = STATE.currentUser.id + '/' + recipeId + '.' + extension;
    const { error: uploadError } = await sb.storage.from('recipe-photos').upload(photoPath, photoFile, {
      cacheControl: '3600', upsert: true, contentType: photoFile.type
    });
    if (uploadError) {
      button.disabled = false;
      button.textContent = originalLabel;
      toast('Food photo upload failed: ' + uploadError.message, 'error');
      return;
    }
    imageUrl = sb.storage.from('recipe-photos').getPublicUrl(photoPath).data.publicUrl;
  }

  const payload = {
    title,
    description: document.getElementById('recipe-description').value.trim() || null,
    image_url: imageUrl,
    cuisine: document.getElementById('recipe-cuisine').value,
    category: document.getElementById('recipe-category').value.trim() || null,
    difficulty: document.getElementById('recipe-difficulty').value,
    prep_minutes: integerValue('recipe-prep'),
    cook_minutes: integerValue('recipe-cook'),
    servings: Math.max(1, integerValue('recipe-servings')),
    ingredients,
    instructions,
    tags
  };
  let result;
  if (editingRecipeId) {
    result = await sb.from('recipes').update(payload).eq('id', recipeId).eq('author_id', STATE.currentUser.id);
  } else {
    result = await sb.from('recipes').insert({...payload,id:recipeId,author_id:STATE.currentUser.id,is_published:true});
  }
  button.disabled = false;
  button.textContent = originalLabel;
  if (result.error) {
    console.error('Recipe save failed:', result.error);
    toast(result.error.message || 'Your recipe could not be saved.', 'error');
    return;
  }
  document.getElementById('recipe-form').reset();
  showRecipePhotoPreview('');
  closeRecipeComposer();
  await loadPublicRecipes();
  await loadPlatformStats();
  toast(wasEditing ? 'Your recipe has been updated.' : 'Your recipe is now published.', 'success');
}
// ── LIVE PLATFORM METRICS ──────────────────────────────────────────
async function loadPlatformStats() {
  const [members, recipes, countries] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'active'),
    sb.from('recipes').select('id', { count: 'exact', head: true }).eq('is_published', true),
    sb.from('profiles').select('country_code').eq('account_status', 'active').not('country_code', 'is', null)
  ]);
  const setMetric = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = Number.isFinite(value) ? value.toLocaleString() : '—';
  };
  setMetric('hub-members', members.error ? NaN : (members.count || 0));
  setMetric('hub-recipes', recipes.error ? NaN : (recipes.count || 0));
  const representedCountries = countries.error ? NaN
    : new Set((countries.data || []).map(row => (row.country_code || '').trim().toUpperCase()).filter(Boolean)).size;
  setMetric('hub-countries', representedCountries);
}

// ── LIVE PUBLIC RECIPE DISCOVERY ───────────────────────────────────
let liveRecipes = [];

async function loadPublicRecipes() {
  const grid = document.getElementById('rgrid');
  if (!grid) return;
  grid.innerHTML = '<div class="recipe-loading">Loading recipes from the community…</div>';

  const { data, error } = await sb.from('recipes')
    .select('id,author_id,title,description,image_url,cuisine,category,difficulty,prep_minutes,cook_minutes,servings,ingredients,instructions,tags,created_at')
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    console.error('Public recipe loading failed:', error);
    grid.innerHTML = '<div class="recipe-loading">Recipes are temporarily unavailable. Please refresh to try again.</div>';
    document.getElementById('noresults').style.display = 'none';
    return;
  }

  const authorIds = [...new Set((data || []).map(recipe => recipe.author_id).filter(Boolean))];
  let authors = [];
  if (authorIds.length) {
    const { data: profiles, error: profileError } = await sb.from('profiles')
      .select('id,full_name,display_name,avatar_url')
      .in('id', authorIds);
    if (!profileError) authors = profiles || [];
  }
  const authorMap = new Map(authors.map(profile => [profile.id, profile]));

  liveRecipes = (data || []).map(recipe => {
    const author = authorMap.get(recipe.author_id) || {};
    return {
      ...recipe,
      author,
      chef: author.display_name || author.full_name || 'Community chef',
      tags: Array.isArray(recipe.tags) ? recipe.tags : []
    };
  });
  filterrecipes();
}

function filterrecipes() {
  const search = (document.getElementById('rsearch')?.value || '').trim().toLowerCase();
  const cuisineFilter = typeof activeTag === 'undefined' ? 'all' : activeTag;
  const filtered = liveRecipes.filter(recipe => {
    const cuisine = (recipe.cuisine || '').toLowerCase();
    const matchesCuisine = cuisineFilter === 'all' || cuisine === cuisineFilter;
    const searchable = [
      recipe.title, recipe.chef, recipe.description, recipe.cuisine,
      recipe.category, ...(recipe.tags || [])
    ].join(' ').toLowerCase();
    return matchesCuisine && (!search || searchable.includes(search));
  });

  const grid = document.getElementById('rgrid');
  const none = document.getElementById('noresults');
  if (!grid || !none) return;
  if (!filtered.length) {
    grid.innerHTML = '';
    none.textContent = liveRecipes.length
      ? 'No recipes match your search. Try another cuisine or keyword.'
      : 'No published community recipes yet. Be among the first to share a dish.';
    none.style.display = '';
    return;
  }

  none.style.display = 'none';
  grid.innerHTML = filtered.map(recipe => {
    const minutes = (Number(recipe.prep_minutes) || 0) + (Number(recipe.cook_minutes) || 0);
    const time = minutes > 0 ? (minutes >= 60 ? Math.floor(minutes / 60) + ' hr ' + (minutes % 60 ? minutes % 60 + ' min' : '') : minutes + ' min') : 'Time not listed';
    const imageUrl = typeof recipe.image_url === 'string' && /^https:\/\//i.test(recipe.image_url)
      ? recipe.image_url : '';
    const image = imageUrl
      ? '<img class="rcard-photo" src="' + escHTML(imageUrl) + '" alt="' + escHTML(recipe.title) + '" loading="lazy" onerror="this.remove()">'
      : '<span class="rcard-placeholder">🍽️</span>';
    const tags = (recipe.tags || []).slice(0, 4)
      .map(tag => '<span class="rtchip">' + escHTML(tag) + '</span>').join('');
    const recipeId = escHTML(recipe.id || '');
    return '<article class="rcard rcard-clickable" role="button" tabindex="0" aria-label="View recipe: ' + escHTML(recipe.title) +
      '" onclick="openRecipeDetail(\'' + recipeId + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openRecipeDetail(\'' + recipeId + '\')}">' +
      '<div class="rcard-img">' + image +
      '<span class="rbadge">' + escHTML(recipe.difficulty || recipe.cuisine || 'Community recipe') + '</span></div>' +
      '<div class="rcard-body"><div class="rcard-title">' + escHTML(recipe.title) + '</div>' +
      '<div class="rcard-author">' + avatarMarkup(recipe.author, 'rcard-author-avatar') +
      '<span class="rcard-chef">by ' + escHTML(recipe.chef) + '</span></div>' +
      '<div class="rcard-meta"><span>⏱ ' + escHTML(time) + '</span>' +
      (recipe.servings ? '<span> · Serves ' + Number(recipe.servings) + '</span>' : '') + '</div>' +
      (recipe.description ? '<p class="rcard-description">' + escHTML(recipe.description) + '</p>' : '') +
      '<div class="rcard-tags">' + tags + '</div><div class="rcard-open-hint">View full recipe →</div></div></article>';
  }).join('');
}

// ── FULL RECIPE VIEW ───────────────────────────────────────────────
function closeRecipeDetail() {
  document.getElementById('recipe-detail-modal')?.classList.remove('op');
}

function openRecipeDetail(recipeId) {
  const recipe = liveRecipes.find(item => String(item.id) === String(recipeId));
  if (!recipe) {
    toast('This recipe is no longer available. Refresh and try again.', 'error');
    return;
  }
  const modal = document.getElementById('recipe-detail-modal');
  const content = document.getElementById('recipe-detail-content');
  if (!modal || !content) return;
  const imageUrl = typeof recipe.image_url === 'string' && /^https:\/\//i.test(recipe.image_url) ? recipe.image_url : '';
  const foodImage = imageUrl
    ? '<img class="recipe-detail-photo" src="' + escHTML(imageUrl) + '" alt="' + escHTML(recipe.title) + '" onerror="this.style.display=\'none\'">'
    : '<div class="recipe-detail-photo recipe-detail-photo-empty">🍽️<span>Food photograph not provided</span></div>';
  const list = value => Array.isArray(value) ? value : [];
  const ingredients = list(recipe.ingredients).map(item => '<li>' + escHTML(String(item)) + '</li>').join('');
  const instructions = list(recipe.instructions).map((step, index) => '<li><span class="recipe-step-number">' + (index + 1) + '</span><span>' + escHTML(String(step)) + '</span></li>').join('');
  const author = recipe.author || {};
  const minutes = (Number(recipe.prep_minutes) || 0) + (Number(recipe.cook_minutes) || 0);
  content.innerHTML = foodImage +
    '<div class="recipe-detail-inner">' +
    '<div class="profile-kicker">' + escHTML(recipe.cuisine || 'COMMUNITY RECIPE') + '</div>' +
    '<h2>' + escHTML(recipe.title) + '</h2>' +
    '<div class="rcard-author recipe-detail-author">' + avatarMarkup(author, 'rcard-author-avatar') +
    '<span class="rcard-chef">Shared by ' + escHTML(recipe.chef || 'Community chef') + '</span></div>' +
    '<div class="recipe-detail-stats">' +
    '<span>Prep: ' + (Number(recipe.prep_minutes) || 0) + ' min</span>' +
    '<span>Cook: ' + (Number(recipe.cook_minutes) || 0) + ' min</span>' +
    '<span>Total: ' + minutes + ' min</span>' +
    '<span>Serves: ' + (Number(recipe.servings) || '—') + '</span>' +
    '<span>Level: ' + escHTML(recipe.difficulty || 'Not specified') + '</span></div>' +
    (recipe.description ? '<p class="recipe-detail-description">' + escHTML(recipe.description) + '</p>' : '') +
    '<h3>Ingredients</h3><ul class="recipe-ingredient-list">' + (ingredients || '<li>Ingredients have not been added.</li>') + '</ul>' +
    '<h3>Preparation</h3><ol class="recipe-instruction-list">' + (instructions || '<li>Preparation steps have not been added.</li>') + '</ol>' +
    (Array.isArray(recipe.tags) && recipe.tags.length ? '<div class="rcard-tags">' + recipe.tags.map(tag => '<span class="rtchip">' + escHTML(tag) + '</span>').join('') + '</div>' : '') +
    (STATE.currentUser && STATE.currentUser.id === recipe.author_id
      ? '<div class="profile-actions" style="margin-top:22px"><button class="btn bp" type="button" onclick="openRecipeEditor(\'' + escHTML(recipe.id) + '\')">Edit my recipe</button></div>'
      : STATE.currentUser
        ? '<div class="profile-actions" style="margin-top:22px"><button class="btn ghost" type="button" onclick="reportCommunityContent(\'recipe\',\'' + escHTML(recipe.id) + '\')">Report recipe</button></div>'
        : '') +
    '</div>';
  modal.classList.add('op');
}

// ── CHECKOUT + NEWSLETTER ───────────────────────────────────────────
let pendingPlanCheckout = null;

async function startPlanCheckout(planCode, button) {
  if (!['pro', 'school'].includes(planCode)) {
    toast('Please choose a valid subscription plan.', 'error');
    return;
  }
  if (!STATE.currentUser) {
    pendingPlanCheckout = planCode;
    openAuth('signup');
    toast('Create your account or sign in, then choose your plan again.', 'success');
    return;
  }

  const billingInterval = (typeof isAnnual !== 'undefined' && isAnnual) ? 'annual' : 'monthly';
  const originalText = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Preparing secure checkout…';
  }

  try {
    const { data, error } = await sb.functions.invoke('create-payment', {
      body: { plan_code: planCode, billing_interval: billingInterval }
    });
    if (error) throw error;
    if (!data?.authorization_url || !data.authorization_url.startsWith('https://')) {
      throw new Error(data?.error || 'Secure checkout could not be opened.');
    }
    window.location.assign(data.authorization_url);
  } catch (error) {
    console.error('Checkout initialization failed:', error);
    toast(error?.message || 'Unable to start checkout. Please try again.', 'error');
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function subnl() {
  const input = document.getElementById('nlemail');
  const email = input?.value.trim();
  const consent = document.getElementById('nl-consent');
  if (!consent?.checked) {
    toast('Please confirm that you want to receive email updates.', 'error');
    return;
  }
  if (!email) {
    toast('Enter your email address first.', 'error');
    return;
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    toast('Enter a valid email address.', 'error');
    return;
  }

  const button = input.parentElement.querySelector('button');
  const originalText = button?.textContent || 'subscribe →';
  if (button) {
    button.disabled = true;
    button.textContent = 'Subscribing…';
  }
  try {
    const { data, error } = await sb.functions.invoke('newsletter-signup', {
      body: { email, website: document.getElementById('nl-website')?.value || '' }
    });
    if (error || data?.error) throw error || new Error(data.error);
    input.value = '';
    consent.checked = false;
    toast('You are subscribed to Global Culinary Hub updates.', 'success');
  } catch (error) {
    console.error('Newsletter signup failed:', error);
    toast('We could not subscribe you just now. Please try again.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
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
  const { error } = await sb.from('friend_requests').update({ status: 'declined' }).eq('id', requestId);
  if (error) { toast(error.message, 'error'); return; }
  const user = getUser(fromId);
  toast(`Request from ${user.name} declined.`);
  await updateBadges();
  renderFriendsPanel();
}

async function withdrawFriendRequest(requestId, toId) {
  const { error } = await sb.from('friend_requests').update({ status: 'withdrawn' }).eq('id', requestId);
  if (error) { toast(error.message, 'error'); return; }
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

function avatarMarkup(profile, className, extraMarkup = '') {
  const user = profile || {};
  const fallback = escHTML(user.emoji || '👤');
  const imageUrl = typeof user.avatar_url === 'string' && user.avatar_url.startsWith('https://') ? user.avatar_url : '';
  const image = imageUrl ? '<img src="' + escHTML(imageUrl) + '" alt="' + escHTML((user.name || user.full_name || 'Profile') + ' photo') + '" loading="lazy" onerror="this.remove()">' : '';
  return '<div class="' + className + '" style="background:' + escHTML(user.color || '#2c5282') + '"><span class="avatar-fallback">' + fallback + '</span>' + image + extraMarkup + '</div>';
}

// ── CONVERSATION-BASED REAL-TIME CHAT ───────────────────────────────
async function openChat(userId) {
  if (!STATE.currentUser) { openAuth('signup'); return; }
  if (!userId || userId === STATE.currentUser.id) return;

  const { data: conversationId, error } = await sb.rpc('get_or_create_dm', { other_user: userId });
  if (error || !conversationId) {
    console.error('Unable to open conversation:', error);
    toast(error?.message || 'Unable to open this conversation.', 'error');
    return;
  }

  const user = getUser(userId);
  STATE.activeChatUserId = userId;
  STATE.activeConversationId = conversationId;
  document.getElementById('chat-with-name').textContent = user.name || 'Member';
  const avatar = document.getElementById('chat-av-icon');
  if (avatar) {
    avatar.outerHTML = avatarMarkup(user, 'chat-head-av', '<div class="chat-online-dot"></div>')
      .replace('class="chat-head-av"', 'class="chat-head-av" id="chat-av-icon"');
  }

  await loadAndRenderMessages(conversationId);
  await sb.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', STATE.currentUser.id);

  document.getElementById('chat-panel').classList.add('op');
  closeChatList();
  setTimeout(() => {
    const body = document.getElementById('chat-body');
    body.scrollTop = body.scrollHeight;
  }, 50);
}

async function loadAndRenderMessages(conversationId) {
  if (!conversationId || !STATE.currentUser) return;
  const { data, error } = await sb.from('messages')
    .select('id,conversation_id,sender_id,body,attachment_url,attachment_type,created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Unable to load conversation messages:', error);
    toast('Messages could not be loaded.', 'error');
    return;
  }
  renderChatMessages(data || []);
}

function renderChatMessages(msgs) {
  const body = document.getElementById('chat-body');
  body.innerHTML = msgs.map(m => {
    const isMe = m.sender_id === STATE.currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const attachment = m.attachment_url
      ? '<a class="chat-attachment" href="' + escHTML(m.attachment_url) + '" target="_blank" rel="noopener noreferrer">View attachment</a>'
      : '';
    return `<div class="chat-msg ${isMe ? 'me' : 'them'}">
      <div class="chat-bubble">${escHTML(m.body || '')}${attachment}</div>
      <div class="chat-time">${time}</div>
    </div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

async function sendChatMsg() {
  const input = document.getElementById('chat-input');
  const messageBody = input.value.trim();
  if (!messageBody || !STATE.activeConversationId || !STATE.currentUser) return;
  if (messageBody.length > 2000) {
    toast('Messages must be 2,000 characters or fewer.', 'error');
    return;
  }

  const { error } = await sb.from('messages').insert({
    conversation_id: STATE.activeConversationId,
    sender_id: STATE.currentUser.id,
    body: messageBody
  });
  if (error) {
    console.error('Message send failed:', error);
    toast('Message failed to send.', 'error');
    return;
  }

  input.value = '';
  await loadAndRenderMessages(STATE.activeConversationId);
  await sb.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', STATE.activeConversationId)
    .eq('user_id', STATE.currentUser.id);
}

function subscribeToMessages() {
  if (STATE.messageChannel) sb.removeChannel(STATE.messageChannel);
  STATE.messageChannel = sb.channel('messages-' + STATE.currentUser.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages'
    }, payload => {
      const msg = payload.new;
      if (!msg || msg.sender_id === STATE.currentUser.id) return;
      if (STATE.activeConversationId === msg.conversation_id &&
          document.getElementById('chat-panel').classList.contains('op')) {
        loadAndRenderMessages(msg.conversation_id);
        sb.from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', msg.conversation_id)
          .eq('user_id', STATE.currentUser.id);
      } else {
        toast('You have a new message 💬');
        renderChatList();
      }
    })
    .subscribe();
}

function closeChat() {
  document.getElementById('chat-panel').classList.remove('op');
  STATE.activeChatUserId = null;
  STATE.activeConversationId = null;
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
  const body = document.getElementById('chat-list-body');

  const { data: memberships, error } = await sb.from('conversation_participants')
    .select('conversation_id,last_read_at,conversations(id,dm_key,is_group,updated_at)')
    .eq('user_id', me);

  if (error) {
    console.error('Unable to load conversations:', error);
    body.innerHTML = '<div class="panel-empty">Conversations could not be loaded.</div>';
    return;
  }
  if (!memberships || !memberships.length) {
    body.innerHTML = '<div class="panel-empty"><div class="pe-icon">💬</div>No conversations yet</div>';
    return;
  }

  const ids = memberships.map(x => x.conversation_id);
  const [{ data: participants, error: participantError }, { data: messages, error: messageError }] = await Promise.all([
    sb.from('conversation_participants').select('conversation_id,user_id').in('conversation_id', ids).neq('user_id', me),
    sb.from('messages').select('conversation_id,sender_id,body,created_at').in('conversation_id', ids).is('deleted_at', null).order('created_at', { ascending: false })
  ]);

  if (participantError || messageError) {
    console.error('Unable to load conversation details:', participantError || messageError);
    body.innerHTML = '<div class="panel-empty">Conversation details could not be loaded.</div>';
    return;
  }

  const otherUsers = new Map((participants || []).map(p => [p.conversation_id, p.user_id]));
  const latest = new Map();
  const unread = new Map();
  const readAt = new Map(memberships.map(m => [m.conversation_id, m.last_read_at ? new Date(m.last_read_at).getTime() : 0]));

  (messages || []).forEach(m => {
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m);
    if (m.sender_id !== me && new Date(m.created_at).getTime() > (readAt.get(m.conversation_id) || 0)) {
      unread.set(m.conversation_id, (unread.get(m.conversation_id) || 0) + 1);
    }
  });

  const items = memberships.map(m => {
    const otherId = otherUsers.get(m.conversation_id);
    const conversation = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations;
    if (!otherId || !conversation) return '';
    const user = getUser(otherId);
    const last = latest.get(m.conversation_id);
    const preview = last ? last.body : 'Start a conversation';
    const count = unread.get(m.conversation_id) || 0;
    const time = last ? new Date(last.created_at).toLocaleDateString() : '';
    return `<div class="conv-item" onclick="openChat('${otherId}')">
      ${avatarMarkup(user, 'conv-av')}
      <div class="conv-info">
        <div class="conv-name">${escHTML(user.name || 'Unknown')}</div>
        <div class="conv-preview">${escHTML(preview)}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${time}</div>
        ${count > 0 ? `<div class="conv-unread">${count}</div>` : ''}
      </div>
    </div>`;
  }).filter(Boolean);

  body.innerHTML = items.length ? items.join('') : '<div class="panel-empty">No conversations yet</div>';
}

// ── FRIENDS PANEL (real DB) ─────────────────────────────────────────
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
        ${avatarMarkup(u, 'freq-av')}
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
        ${avatarMarkup(u, 'freq-av')}
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
      ${avatarMarkup(u, 'fi-av')}
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
        ${avatarMarkup(u, 'chef-avatar')}
        <div class="chef-info">
          <div class="chef-name" role="button" tabindex="0" onclick="openPublicProfile('${u.id}')" onkeydown="if(event.key==='Enter'||event.key===' ')openPublicProfile('${u.id}')">${escHTML(u.name)}</div>
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


/* ── PERSONAL PROFILE ───────────────────────────────────────────── */
async function openMyProfile() {
  if (!STATE.currentUser) { openAuth('login'); return; }
  const profile = STATE.currentUser;
  const { data: authData } = await sb.auth.getUser();
  const email = authData?.user?.email || '';
  document.getElementById('profile-email-display').textContent = email;
  document.getElementById('profile-full-name').value = profile.full_name || profile.name || '';
  document.getElementById('profile-display-name').value = profile.display_name || '';
  document.getElementById('profile-username').value = profile.username || '';
  document.getElementById('profile-role').value = (profile.role || 'food-lover').replace('-', ' ');
  document.getElementById('profile-city').value = profile.city || '';
  document.getElementById('profile-country').value = (profile.country_code || '').trim();
  document.getElementById('profile-bio').value = profile.bio || '';
  document.getElementById('profile-avatar-url').value = profile.avatar_url || '';
  document.getElementById('profile-photo-file').value = '';
  document.getElementById('profile-website').value = profile.website_url || '';
  document.getElementById('profile-instagram').value = profile.instagram_url || '';
  const avatar = document.getElementById('profile-avatar');
  avatar.innerHTML = profile.avatar_url
    ? '<img src="' + escHTML(profile.avatar_url) + '" alt="Profile photo" onerror="this.parentElement.textContent=\'👤\'">'
    : '👤';
  await loadMyPrivacyRequests();
  document.getElementById('profile-modal').classList.add('op');
}
function closeMyProfile() {
  document.getElementById('profile-modal').classList.remove('op');
}
function previewProfilePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    event.target.value = '';
    toast('Choose a JPG, PNG, WEBP or GIF image.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = '';
    toast('Profile pictures must be 5 MB or smaller.', 'error');
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  document.getElementById('profile-avatar').innerHTML = '<img src="' + previewUrl + '" alt="Selected profile photo">';
}
async function saveMyProfile(event) {
  event.preventDefault();
  if (!STATE.currentUser) { toast('Please sign in again.', 'error'); return; }
  const fullName = document.getElementById('profile-full-name').value.trim();
  const country = document.getElementById('profile-country').value.trim().toUpperCase();
  const username = document.getElementById('profile-username').value.trim();
  if (!fullName) { toast('Full name is required.', 'error'); return; }
  if (username && !/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    toast('Username must be 3–30 characters and use letters, numbers, dots, underscores or hyphens.', 'error'); return;
  }
  if (country && !/^[A-Z]{2}$/.test(country)) { toast('Country code must contain exactly two letters, such as NG.', 'error'); return; }
  const button = document.getElementById('profile-save-btn');
  button.disabled = true;
  button.textContent = 'Saving…';
  let avatarUrl = document.getElementById('profile-avatar-url').value.trim() || null;
  const photoFile = document.getElementById('profile-photo-file').files[0];
  if (photoFile) {
    const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[photoFile.type];
    const photoPath = STATE.currentUser.id + '/profile-photo.' + extension;
    const { error: uploadError } = await sb.storage.from('profile-photos').upload(photoPath, photoFile, {
      cacheControl: '3600', upsert: true, contentType: photoFile.type
    });
    if (uploadError) {
      button.disabled = false;
      button.textContent = 'Save changes';
      toast('Photo upload failed: ' + uploadError.message, 'error');
      return;
    }
    const { data: publicUrlData } = sb.storage.from('profile-photos').getPublicUrl(photoPath);
    avatarUrl = publicUrlData.publicUrl;
  }
  const updates = {
    full_name: fullName,
    display_name: document.getElementById('profile-display-name').value.trim() || null,
    username: username || null,
    city: document.getElementById('profile-city').value.trim() || null,
    country_code: country || null,
    bio: document.getElementById('profile-bio').value.trim() || null,
    avatar_url: avatarUrl,
    website_url: document.getElementById('profile-website').value.trim() || null,
    instagram_url: document.getElementById('profile-instagram').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await sb.from('profiles').update(updates).eq('id', STATE.currentUser.id).select().single();
  button.disabled = false;
  button.textContent = 'Save changes';
  if (error) { toast(error.message, 'error'); return; }
  STATE.currentUser = normalizeProfile(data);
  await loadAllProfiles();
  renderChefGrid(STATE.profiles);
  const avatar = document.getElementById('profile-avatar');
  avatar.innerHTML = data.avatar_url
    ? '<img src="' + escHTML(data.avatar_url) + '" alt="Profile photo" onerror="this.parentElement.textContent=\'👤\'">'
    : '👤';
  toast('Your profile has been saved.', 'success');
  closeMyProfile();
}



async function loadMarketplace(){
 const catalogue=document.getElementById('marketplace-products');if(!catalogue)return;
 const {data:products,error}=await sb.from('products').select('id,seller_id,title,description,product_type,category,price_minor,currency,cover_url,is_published,created_at').eq('is_published',true).order('created_at',{ascending:false}).limit(60);
 if(error){catalogue.textContent='The marketplace is temporarily unavailable.';console.error('Marketplace load:',error)}
 else if(!products?.length)catalogue.innerHTML='<p class="learn-muted">No digital products have been published yet. Be the first chef to open a storefront.</p>';
 else{
  const sellerIds=[...new Set(products.map(p=>p.seller_id))],{data:sellers}=await sb.from('profiles').select('id,full_name,display_name').in('id',sellerIds),sellerNames=new Map((sellers||[]).map(p=>[p.id,p.display_name||p.full_name||'Culinary creator']));
  let ownedIds=new Set();if(STATE.currentUser){const {data:owned}=await sb.from('product_purchases').select('product_id').eq('buyer_id',STATE.currentUser.id);ownedIds=new Set((owned||[]).map(x=>x.product_id))}
  catalogue.innerHTML=products.map(p=>{
   const mine=STATE.currentUser?.id===p.seller_id,owned=ownedIds.has(p.id),image=p.cover_url?'<img src="'+escHTML(p.cover_url)+'" alt="" loading="lazy" style="width:100%;height:150px;object-fit:cover;border-radius:8px">':'<div style="height:110px;border-radius:8px;background:var(--ice);display:grid;place-items:center;font-size:42px">📚</div>',action=owned?'<button class="btn bp" onclick="downloadMarketplaceProduct(\''+escHTML(p.id)+'\')">Download purchase</button>':mine?'<span class="learn-muted">Your storefront item</span>':'<button class="btn bp" onclick="buyMarketplaceProduct(\''+escHTML(p.id)+'\')">Buy securely</button>',searchText=[p.title,p.description,p.category,p.product_type,sellerNames.get(p.seller_id)].filter(Boolean).join(' ').toLowerCase();
   return '<article class="market-product" data-search="'+escHTML(searchText)+'" data-category="'+escHTML(p.category||'Other')+'" data-price="'+Number(p.price_minor||0)+'" data-created="'+new Date(p.created_at).getTime()+'">'+image+'<div class="market-product-type">'+escHTML((p.category||'Culinary resource').toUpperCase())+'</div><h4>'+escHTML(p.title)+'</h4><p class="learn-muted">'+escHTML(p.description||'Digital resource from a culinary creator.')+'</p><p class="learn-meta">By '+escHTML(sellerNames.get(p.seller_id)||'Culinary creator')+'</p><div class="market-product-footer"><strong>'+formatCoursePrice(p.price_minor,p.currency)+'</strong>'+action+'</div></article>';
  }).join('');
 }
 filterMarketplaceProducts();
 const form=document.getElementById('marketplace-product-form'),sellerPanel=document.getElementById('marketplace-seller-products'),library=document.getElementById('marketplace-library'),stats=document.getElementById('marketplace-seller-stats');
 if(!STATE.currentUser){if(form)form.style.display='none';if(sellerPanel)sellerPanel.innerHTML='<p class="learn-muted">Sign in to publish and manage digital products.</p>';if(library)library.innerHTML='<p class="learn-muted">Sign in to view your purchased downloads.</p>';if(stats)stats.innerHTML='';return}
 if(form)form.style.display='';
 const [mine,purchases]=await Promise.all([
  sb.from('products').select('id,title,product_type,category,price_minor,currency,is_published,created_at').eq('seller_id',STATE.currentUser.id).order('created_at',{ascending:false}),
  sb.from('product_purchases').select('product_id,amount_minor,currency,refunded_at').eq('seller_id',STATE.currentUser.id).is('refunded_at',null).order('created_at',{ascending:false})
 ]);
 const paidSales=purchases.data||[],gross=paidSales.reduce((sum,p)=>sum+Number(p.amount_minor||0),0);
 if(stats)stats.innerHTML='<div class="market-stats"><div><strong>'+((mine.data||[]).length)+'</strong><span>Total products</span></div><div><strong>'+((mine.data||[]).filter(p=>p.is_published).length)+'</strong><span>Published</span></div><div><strong>'+paidSales.length+'</strong><span>Paid sales</span></div><div><strong>'+formatCoursePrice(gross,'NGN')+'</strong><span>Gross sales · before fees/refunds</span></div></div>';
 if(sellerPanel){if(mine.error)sellerPanel.textContent='Unable to load your storefront items.';else sellerPanel.innerHTML=(mine.data||[]).map(p=>'<div class="market-row"><span><strong>'+escHTML(p.title)+'</strong><br><small>'+(p.is_published?'Published':'Draft / hidden')+' · '+escHTML(p.category||'Other')+' · '+formatCoursePrice(p.price_minor,p.currency)+'</small></span><span class="learn-actions"><button class="btn bo" onclick="editMarketplaceProduct(\''+escHTML(p.id)+'\')">Edit</button><button class="btn bo" onclick="replaceMarketplaceProductFile(\''+escHTML(p.id)+'\')">Replace file</button><button class="btn bo" onclick="toggleMarketplaceProduct(\''+escHTML(p.id)+'\','+(!p.is_published)+')">'+(p.is_published?'Unpublish':'Publish')+'</button><button class="btn bo" onclick="deleteMarketplaceProduct(\''+escHTML(p.id)+'\')">Delete</button></span></div>').join('')||'<p class="learn-muted">You have not published a digital product yet.</p>'}
 if(library){
  if(purchases.error)library.textContent='Unable to load your purchases.';
  else{const {data:buyerPurchases,error:buyerError}=await sb.from('product_purchases').select('id,product_id,amount_minor,currency,created_at,products(title,product_type),payments(status)').eq('buyer_id',STATE.currentUser.id).order('created_at',{ascending:false});if(buyerError)library.textContent='Unable to load your purchases.';else library.innerHTML=(buyerPurchases||[]).filter(p=>p.payments?.status==='paid').map(p=>'<div class="market-row"><span><strong>'+escHTML(p.products?.title||'Digital product')+'</strong><br><small>Purchased '+new Date(p.created_at).toLocaleDateString()+' · '+formatCoursePrice(p.amount_minor,p.currency)+'</small></span><button class="btn bo" onclick="downloadMarketplaceProduct(\''+escHTML(p.product_id)+'\')">Download</button></div>').join('')||'<p class="learn-muted">Your purchased downloads will appear here.</p>'}
 }
}
function filterMarketplaceProducts(){
 const search=(document.getElementById('marketplace-search')?.value||'').trim().toLowerCase(),category=document.getElementById('marketplace-category-filter')?.value||'',sort=document.getElementById('marketplace-sort')?.value||'newest',grid=document.getElementById('marketplace-products');if(!grid)return;
 const cards=[...grid.querySelectorAll('.market-product')];cards.forEach(card=>{card.hidden=!((!search||(card.dataset.search||'').includes(search))&&(!category||card.dataset.category===category))});
 const visible=cards.filter(c=>!c.hidden);visible.sort((a,b)=>sort==='title'?a.querySelector('h4').textContent.localeCompare(b.querySelector('h4').textContent):sort==='price-low'?Number(a.dataset.price)-Number(b.dataset.price):sort==='price-high'?Number(b.dataset.price)-Number(a.dataset.price):Number(b.dataset.created)-Number(a.dataset.created));visible.forEach(c=>grid.appendChild(c));
 const empty=document.getElementById('marketplace-filter-empty');if(empty)empty.hidden=cards.length===0||visible.length>0;
}
async function editMarketplaceProduct(productId){
 const {data:p,error}=await sb.from('products').select('id,title,description,category,price_minor,cover_url').eq('id',productId).eq('seller_id',STATE.currentUser.id).single();if(error||!p){toast('Product could not be loaded.','error');return}
 const title=prompt('Product title:',p.title);if(title===null)return;const description=prompt('Product description:',p.description||'');if(description===null)return;const category=prompt('Category (e.g. Nigerian cuisine, Baking & Pastry, Global cuisine):',p.category||'Other');if(category===null)return;const price=prompt('Price in NGN:',String(Number(p.price_minor)/100));if(price===null)return;const cover=prompt('Cover image HTTPS URL (leave blank for none):',p.cover_url||'');if(cover===null)return;
 const amount=Number(price);if(!title.trim()||title.trim().length>120||!Number.isFinite(amount)||amount<1||amount>100000000||category.trim().length>60||description.length>1200){toast('Check the title, category, description and price.','error');return}
 if(cover.trim()){try{if(new URL(cover.trim()).protocol!=='https:')throw 0}catch{toast('Cover image must use HTTPS.','error');return}}
 const {error:updateError}=await sb.from('products').update({title:title.trim(),description:description.trim(),category:category.trim()||'Other',price_minor:Math.round(amount*100),cover_url:cover.trim()||null,updated_at:new Date().toISOString()}).eq('id',productId).eq('seller_id',STATE.currentUser.id);if(updateError){toast('Product update failed: '+updateError.message,'error');return}toast('Product details updated.','success');await loadMarketplace();
}
async function toggleMarketplaceProduct(productId,publish){
 const {data:p,error}=await sb.from('products').select('id,file_path').eq('id',productId).eq('seller_id',STATE.currentUser.id).single();if(error||!p){toast('Product could not be found.','error');return}if(publish&&!p.file_path){toast('Upload a digital file before publishing this product.','error');return}
 const {error:updateError}=await sb.from('products').update({is_published:!!publish,updated_at:new Date().toISOString()}).eq('id',productId).eq('seller_id',STATE.currentUser.id);if(updateError){toast('Listing status could not be changed.','error');return}toast(publish?'Product published.':'Product hidden from the marketplace.','success');await loadMarketplace();
}
async function replaceMarketplaceProductFile(productId){
 if(!STATE.currentUser){openAuth('login');return}
 const picker=document.createElement('input');picker.type='file';picker.accept='.pdf,.zip,.epub,.docx,.pptx,.xlsx';picker.style.display='none';document.body.appendChild(picker);
 picker.onchange=async()=>{const file=picker.files?.[0];picker.remove();if(!file)return;const allowed=['application/pdf','application/zip','application/epub+zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];if(!allowed.includes(file.type)||file.size>52428800){toast('Choose a supported file up to 50 MB.','error');return}
  const {data:p,error}=await sb.from('products').select('file_path').eq('id',productId).eq('seller_id',STATE.currentUser.id).single();if(error||!p){toast('Product could not be loaded.','error');return}
  const name=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100),path=STATE.currentUser.id+'/'+productId+'/'+crypto.randomUUID()+'-'+name,{error:uploadError}=await sb.storage.from('product-files').upload(path,file,{contentType:file.type,upsert:false});if(uploadError){toast('File upload failed: '+uploadError.message,'error');return}
  const {error:updateError}=await sb.from('products').update({file_path:path,updated_at:new Date().toISOString()}).eq('id',productId).eq('seller_id',STATE.currentUser.id);if(updateError){await sb.storage.from('product-files').remove([path]);toast('File replacement failed.','error');return}if(p.file_path)await sb.storage.from('product-files').remove([p.file_path]);toast('Digital file replaced securely.','success');await loadMarketplace();
 };picker.click();
}
async function deleteMarketplaceProduct(productId){
 if(!confirm('Delete this product permanently? Products with purchase history cannot be deleted; hide them instead.'))return;
 const {count,error:countError}=await sb.from('product_purchases').select('id',{count:'exact',head:true}).eq('product_id',productId);if(countError){toast('Purchase history could not be checked.','error');return}if(count>0){toast('This product has purchase history. Unpublish it instead so records and buyer access remain auditable.','error');return}
 const {data:p,error}=await sb.from('products').select('file_path').eq('id',productId).eq('seller_id',STATE.currentUser.id).single();if(error||!p){toast('Product could not be found.','error');return}
 if(p.file_path){const {error:fileError}=await sb.storage.from('product-files').remove([p.file_path]);if(fileError){toast('The private file could not be removed; product was left unchanged.','error');return}}const {error:deleteError}=await sb.from('products').delete().eq('id',productId).eq('seller_id',STATE.currentUser.id);if(deleteError){if(p.file_path)await sb.from('products').update({file_path:null,is_published:false}).eq('id',productId).eq('seller_id',STATE.currentUser.id);toast('Product record could not be deleted. Its listing has been hidden for safety.','error');return}toast('Product deleted.','success');await loadMarketplace();
}
async function createMarketplaceProduct(event){
 event.preventDefault();if(!STATE.currentUser){openAuth('login');return}
 const form=document.getElementById('marketplace-product-form'),title=document.getElementById('marketplace-product-title').value.trim(),description=document.getElementById('marketplace-product-description').value.trim(),type=document.getElementById('marketplace-product-type').value,category=document.getElementById('marketplace-product-category').value,price=Number(document.getElementById('marketplace-product-price').value),cover=document.getElementById('marketplace-product-cover').value.trim(),file=document.getElementById('marketplace-product-file').files[0],allowed=['application/pdf','application/zip','application/epub+zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
 if(!title||title.length>120||description.length>1200||!Number.isFinite(price)||price<1||price>100000000||!['recipe_book','digital_download'].includes(type)||!category){toast('Enter a valid title, category and price.','error');return}
 if(!file||!allowed.includes(file.type)||file.size>52428800){toast('Choose a PDF, ZIP, EPUB, DOCX, PPTX or XLSX file up to 50 MB.','error');return}if(cover){try{if(new URL(cover).protocol!=='https:')throw 0}catch{toast('Cover image must use HTTPS.','error');return}}
 const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent='Publishing…'}let productId=null,uploadedPath=null;
 try{const {data:product,error:insertError}=await sb.from('products').insert({seller_id:STATE.currentUser.id,title,description,product_type:type,category,price_minor:Math.round(price*100),currency:'NGN',cover_url:cover||null,is_published:false}).select('id').single();if(insertError)throw insertError;productId=product.id;
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100);uploadedPath=STATE.currentUser.id+'/'+productId+'/'+crypto.randomUUID()+'-'+safeName;const {error:uploadError}=await sb.storage.from('product-files').upload(uploadedPath,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;
  const {error:updateError}=await sb.from('products').update({file_path:uploadedPath,is_published:true,updated_at:new Date().toISOString()}).eq('id',productId).eq('seller_id',STATE.currentUser.id);if(updateError)throw updateError;form.reset();toast('Your digital product is now published in the marketplace.','success');await loadMarketplace();
 }catch(error){console.error('Product publishing failed:',error);if(uploadedPath)await sb.storage.from('product-files').remove([uploadedPath]);if(productId)await sb.from('products').delete().eq('id',productId).eq('seller_id',STATE.currentUser.id);toast('Product could not be published: '+(error.message||'Please try again.'),'error')}
 finally{if(submit){submit.disabled=false;submit.textContent='Publish digital product'}}
}
async function buyMarketplaceProduct(productId){
 if(!STATE.currentUser){openAuth('login');toast('Sign in to purchase this download.');return}const {data:product,error}=await sb.from('products').select('id,seller_id,is_published').eq('id',productId).eq('is_published',true).maybeSingle();if(error||!product){toast('This product is no longer available.','error');return}if(product.seller_id===STATE.currentUser.id){toast('You cannot purchase your own product.','error');return}
 const {data,error:checkoutError}=await sb.functions.invoke('create-payment',{body:{purpose:'product_purchase',product_id:productId}});if(checkoutError||!data?.authorization_url){toast(checkoutError?.message||data?.error||'Checkout could not be started.','error');return}window.location.assign(data.authorization_url);
}
async function downloadMarketplaceProduct(productId){
 if(!STATE.currentUser){openAuth('login');return}const {data:product,error}=await sb.from('products').select('file_path,title,seller_id').eq('id',productId).maybeSingle();if(error||!product?.file_path){toast('Download is not available for this product.','error');return}
 if(product.seller_id!==STATE.currentUser.id){const {data:purchase,error:purchaseError}=await sb.from('product_purchases').select('id,payments(status)').eq('product_id',productId).eq('buyer_id',STATE.currentUser.id).maybeSingle();if(purchaseError||purchase?.payments?.status!=='paid'){toast('A completed, non-refunded purchase is required to download this file.','error');return}}
 const {data,error:signError}=await sb.storage.from('product-files').createSignedUrl(product.file_path,300);if(signError||!data?.signedUrl){toast('Secure download could not be created.','error');return}window.location.assign(data.signedUrl);
}

async function loadLearningDashboard(){
 const catalogue=document.getElementById('learning-course-catalogue');if(!catalogue)return;
 const {data:courses,error}=await sb.from('courses').select('id,title,description,price_minor,currency,instructor_id').eq('is_published',true).order('created_at',{ascending:false}).limit(30);
 if(error){catalogue.textContent='Courses are temporarily unavailable.';console.error(error)}
 else if(!courses?.length)catalogue.innerHTML='<p class="learn-muted">No published courses yet.</p>';
 else{
  const ids=[...new Set(courses.map(c=>c.instructor_id))];
  const {data:teachers}=await sb.from('profiles').select('id,full_name,display_name').in('id',ids);
  const names=new Map((teachers||[]).map(p=>[p.id,p.display_name||p.full_name||'Instructor']));
  catalogue.innerHTML=courses.map(c=>'<article class="learn-course"><h4>'+escHTML(c.title)+'</h4><p class="learn-muted">'+escHTML(c.description||'Course details coming soon.')+'</p><p class="learn-meta">'+escHTML(names.get(c.instructor_id)||'Instructor')+' · '+(Number(c.price_minor)===0?'Free':formatCoursePrice(c.price_minor,c.currency))+'</p><div class="learn-actions"><button class="btn bp" onclick="enrolLearningCourse(\''+escHTML(c.id)+'\')">'+(Number(c.price_minor)===0?'Enrol for free':'Paid course')+'</button><button class="btn bo" onclick="viewLearningCourse(\''+escHTML(c.id)+'\')">Lessons</button></div></article>').join('');
 }
 const dashboard=document.getElementById('learning-student-dashboard'),instructor=document.getElementById('learning-instructor-courses');
 if(!STATE.currentUser){dashboard.textContent='Sign in to view your learning progress.';instructor.textContent='Sign in to manage courses.';return}
 const [enrolments,own]=await Promise.all([sb.from('enrollments').select('id,course_id,courses(title)').eq('student_id',STATE.currentUser.id).is('revoked_at',null),sb.from('courses').select('id,title,is_published').eq('instructor_id',STATE.currentUser.id)]);
 if(enrolments.error)dashboard.textContent='Unable to load enrolments.';else if(!enrolments.data?.length)dashboard.innerHTML='<p class="learn-muted">You have not enrolled in a course yet.</p>';else{
  const {data:progress}=await sb.from('lesson_progress').select('enrollment_id,lesson_id').eq('student_id',STATE.currentUser.id);
  const {data:lessons}=await sb.from('course_lessons').select('id,course_id').eq('is_published',true);
  dashboard.innerHTML=enrolments.data.map(e=>{const total=(lessons||[]).filter(l=>l.course_id===e.course_id).length,done=(progress||[]).filter(p=>p.enrollment_id===e.id).length,pct=total?Math.round(done/total*100):0;return '<div class="learn-course"><h4>'+escHTML(e.courses?.title||'Course')+'</h4><p class="learn-meta">'+done+' / '+total+' lessons · '+pct+'%</p><div class="learn-progress"><span style="width:'+pct+'%"></span></div><button class="btn bo" onclick="viewLearningCourse(\''+escHTML(e.course_id)+'\')">Continue</button></div>'}).join('');
 }
 instructor.innerHTML=(own.data||[]).map(c=>'<div class="learn-lesson"><span>'+escHTML(c.title)+' · '+(c.is_published?'Published':'Draft')+'</span><div class="learn-actions"><button class="btn bo" onclick="addLearningLesson(\''+escHTML(c.id)+'\')">Add lesson</button><button class="btn bo" onclick="createCourseAssessment(\''+escHTML(c.id)+'\')">Create assessment</button>'+(c.is_published?'':'<button class="btn bp" onclick="publishLearningCourse(\''+escHTML(c.id)+'\')">Publish</button>')+'</div></div>').join('')||'<p class="learn-muted">No courses created yet.</p>';
}
function formatCoursePrice(minor,currency){const amount=Number(minor||0)/100;try{return new Intl.NumberFormat(undefined,{style:'currency',currency:(currency||'NGN').trim()}).format(amount)}catch{return (currency||'NGN')+' '+amount.toFixed(2)}}
async function createLearningCourse(event){
 event.preventDefault();if(!STATE.currentUser){openAuth('login');return}
 const title=document.getElementById('learning-course-title').value.trim(),description=document.getElementById('learning-course-description').value.trim(),price=Number(document.getElementById('learning-course-price').value),cover=document.getElementById('learning-course-cover').value.trim();
 if(!title||!Number.isFinite(price)||price<0){toast('Enter a valid course title and price.','error');return}
 if(cover){try{if(new URL(cover).protocol!=='https:')throw 0}catch{toast('Cover URL must use HTTPS.','error');return}}
 const slug=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)+'-'+crypto.randomUUID().slice(0,8);
 const {error}=await sb.from('courses').insert({instructor_id:STATE.currentUser.id,title,slug,description,cover_url:cover||null,price_minor:Math.round(price*100),currency:'NGN',is_published:false});
 if(error){toast('Course creation failed: '+error.message,'error');return}
 document.getElementById('learning-course-form').reset();document.getElementById('learning-course-price').value='0';toast('Course draft created. Add lessons, then publish it.','success');await loadLearningDashboard();
}
async function addLearningLesson(courseId){
 const title=prompt('Lesson title:');if(!title?.trim())return;const content=prompt('Lesson notes (optional):')||'';
 const {data:rows}=await sb.from('course_lessons').select('position').eq('course_id',courseId).order('position',{ascending:false}).limit(1);
 const {error}=await sb.from('course_lessons').insert({course_id:courseId,title:title.trim(),content,position:(rows?.[0]?.position||0)+1,is_published:false});
 if(error){toast('Lesson could not be added: '+error.message,'error');return}toast('Lesson draft added.','success');await viewLearningCourse(courseId);
}
async function enrolLearningCourse(courseId){
 if(!STATE.currentUser){openAuth('login');return}
 const {data:course,error}=await sb.from('courses').select('id,price_minor,currency,instructor_id').eq('id',courseId).eq('is_published',true).single();
 if(error||!course){toast('Course unavailable.','error');return}
 const {data:existing}=await sb.from('enrollments').select('id').eq('course_id',courseId).eq('student_id',STATE.currentUser.id).is('revoked_at',null).maybeSingle();
 if(existing){toast('You are already enrolled in this course.','success');await loadLearningDashboard();return}
 if(Number(course.price_minor)>0){
  const {data,error:checkoutError}=await sb.functions.invoke('create-payment',{body:{purpose:'course_enrollment',course_id:courseId}});
  if(checkoutError||!data?.authorization_url){toast(checkoutError?.message||data?.error||'Course checkout could not be started.','error');return}
  window.location.assign(data.authorization_url);return;
 }
 const {error:enrolError}=await sb.rpc('enroll_free_course',{course_uuid:courseId});
 if(enrolError){toast('Enrolment failed: '+enrolError.message,'error');return}
 toast('You are enrolled!','success');await loadLearningDashboard();
}
async function viewLearningCourse(courseId){
 const {data:course,error}=await sb.from('courses').select('id,title,description,instructor_id').eq('id',courseId).single();if(error||!course){toast('Course unavailable.','error');return}
 const {data:lessons}=await sb.from('course_lessons').select('id,title,description,content,position,is_published').eq('course_id',courseId).order('position');
 const {data:enrol}=STATE.currentUser?await sb.from('enrollments').select('id').eq('course_id',courseId).eq('student_id',STATE.currentUser.id).is('revoked_at',null).maybeSingle():{data:null};
 const {data:assessments}=await sb.from('course_assessments').select('id,title,description,is_published,pass_percentage').eq('course_id',courseId).order('created_at');
 const host=document.getElementById('learning-student-dashboard');if(!host)return;
 const lessonMarkup=(lessons||[]).map(l=>'<div class="learn-lesson"><span><strong>'+escHTML(l.title)+'</strong><br>'+escHTML(l.content||l.description||'')+'</span>'+(enrol&&l.is_published?'<button class="btn bo" onclick="completeLearningLesson(\''+escHTML(enrol.id)+'\',\''+escHTML(l.id)+'\')">Complete</button>':(course.instructor_id===STATE.currentUser?.id&&!l.is_published?'<button class="btn bo" onclick="publishLearningLesson(\''+escHTML(l.id)+'\',\''+escHTML(courseId)+'\')">Publish lesson</button>':''))+'</div>').join('');
 const assessmentMarkup=(assessments||[]).map(a=>'<div class="learn-lesson"><span><strong>'+escHTML(a.title)+'</strong><br><small>Pass mark: '+Number(a.pass_percentage)+'%</small></span>'+(enrol&&a.is_published?'<button class="btn bo" onclick="startCourseAssessment(\''+escHTML(a.id)+'\')">Take assessment</button>':(course.instructor_id===STATE.currentUser?.id?'<div class="learn-actions"><button class="btn bo" onclick="addAssessmentQuestion(\''+escHTML(a.id)+'\',\''+escHTML(courseId)+'\')">Add question</button>'+(a.is_published?'':'<button class="btn bp" onclick="publishCourseAssessment(\''+escHTML(a.id)+'\',\''+escHTML(courseId)+'\')">Publish assessment</button>')+'</div>':''))+'</div>').join('');
 host.innerHTML='<div class="learn-course"><h4>'+escHTML(course.title)+'</h4><p class="learn-muted">'+escHTML(course.description||'')+'</p><h4>Lessons</h4>'+(lessonMarkup||'<p class="learn-muted">No lessons have been added yet.</p>')+'<h4 style="margin-top:18px">Assessments</h4>'+(assessmentMarkup||'<p class="learn-muted">No assessments published yet.</p>')+(enrol?'<div class="learn-actions"><button class="btn bp" onclick="requestCourseCertificate(\''+escHTML(enrol.id)+'\')">Request certificate</button></div>':'')+'<button class="btn bo" onclick="loadLearningDashboard()">Back to dashboard</button></div>';
}
async function completeLearningLesson(enrollmentId,lessonId){
 const {error}=await sb.from('lesson_progress').upsert({student_id:STATE.currentUser.id,enrollment_id:enrollmentId,lesson_id:lessonId},{onConflict:'student_id,enrollment_id,lesson_id'});
 if(error){toast('Progress could not be saved: '+error.message,'error');return}toast('Lesson completed.','success');await loadLearningDashboard();
}
async function publishLearningLesson(lessonId,courseId){
 const {error}=await sb.from('course_lessons').update({is_published:true}).eq('id',lessonId);
 if(error){toast('Lesson publish failed: '+error.message,'error');return}toast('Lesson published.','success');await viewLearningCourse(courseId);await loadLearningDashboard();
}
async function publishLearningCourse(courseId){
 const {data:rows,error:readError}=await sb.from('course_lessons').select('id').eq('course_id',courseId).eq('is_published',true);
 if(readError||!rows?.length){toast('Publish at least one lesson first.','error');return}
 const {error}=await sb.from('courses').update({is_published:true,updated_at:new Date().toISOString()}).eq('id',courseId).eq('instructor_id',STATE.currentUser.id);
 if(error){toast('Course publish failed: '+error.message,'error');return}toast('Course published.','success');await loadLearningDashboard();
}


async function createCourseAssessment(courseId){
 if(!STATE.currentUser)return;
 const title=prompt('Assessment title:');if(!title?.trim())return;
 const description=prompt('Assessment instructions (optional):')||'';
 const pass=Number(prompt('Pass percentage (default 70):','70')||70);
 if(!Number.isInteger(pass)||pass<1||pass>100){toast('Pass percentage must be between 1 and 100.','error');return}
 const {data,error}=await sb.from('course_assessments').insert({course_id:courseId,title:title.trim(),description,pass_percentage:pass,is_published:false}).select('id').single();
 if(error){toast('Assessment could not be created: '+error.message,'error');return}
 toast('Assessment draft created. Add questions next.','success');
 await addAssessmentQuestion(data.id,courseId);
}
async function addAssessmentQuestion(assessmentId,courseId){
 const promptText=prompt('Question text:');if(!promptText?.trim())return;
 const raw=prompt('Enter 2–6 answer options separated by | (example: Option A | Option B | Option C):');if(!raw)return;
 const options=raw.split('|').map(x=>x.trim()).filter(Boolean);
 if(options.length<2||options.length>6){toast('Provide between 2 and 6 options.','error');return}
 const answer=Number(prompt('Which option is correct? Enter its number (starting at 1):','1'));
 if(!Number.isInteger(answer)||answer<1||answer>options.length){toast('Correct option number is invalid.','error');return}
 const explanation=prompt('Explanation (optional):')||'';
 const {data:existing}=await sb.from('assessment_questions').select('position').eq('assessment_id',assessmentId).order('position',{ascending:false}).limit(1);
 const {error}=await sb.from('assessment_questions').insert({assessment_id:assessmentId,prompt:promptText.trim(),options,correct_option:answer-1,explanation,position:(existing?.[0]?.position||0)+1});
 if(error){toast('Question could not be saved: '+error.message,'error');return}
 if(confirm('Question saved. Add another question?')){await addAssessmentQuestion(assessmentId,courseId);return}
 await viewLearningCourse(courseId);
}
async function publishCourseAssessment(assessmentId,courseId){
 const {data:questions,error:readError}=await sb.from('assessment_questions').select('id').eq('assessment_id',assessmentId);
 if(readError||!questions?.length){toast('Add at least one question before publishing.','error');return}
 const {error}=await sb.rpc('publish_course_assessment',{p_assessment_id:assessmentId});
 if(error){toast('Could not publish assessment: '+error.message,'error');return}
 toast('Assessment published and locked against further edits.','success');await viewLearningCourse(courseId);
}
async function startCourseAssessment(assessmentId){
 const {data,error}=await sb.rpc('get_assessment_for_student',{p_assessment_id:assessmentId});
 if(error){toast('Assessment unavailable: '+error.message,'error');return}
 if(!data.questions?.length){toast('This assessment has no questions yet.','error');return}
 const host=document.getElementById('learning-student-dashboard');
 host.innerHTML='<div class="learn-course"><h3>'+escHTML(data.title)+'</h3><p class="learn-muted">'+escHTML(data.description||'')+' · Pass mark '+Number(data.pass_percentage)+'%</p><form id="course-assessment-form" onsubmit="submitCourseAssessment(event,\''+escHTML(assessmentId)+'\')">'+data.questions.map((q,i)=>'<fieldset style="border:0;border-top:1px solid var(--border);padding:14px 0"><legend><strong>'+(i+1)+'. '+escHTML(q.prompt)+'</strong></legend>'+q.options.map((o,n)=>'<label style="display:block;margin:8px 0;font-weight:400"><input type="radio" name="q_'+escHTML(q.id)+'" value="'+n+'" required> '+escHTML(o)+'</label>').join('')+'</fieldset>').join('')+'<button class="btn bp" type="submit">Submit answers</button></form><button class="btn bo" onclick="loadLearningDashboard()">Exit assessment</button></div>';
}
async function submitCourseAssessment(event,assessmentId){
 event.preventDefault();const form=event.currentTarget,answers={};
 form.querySelectorAll('input[type="radio"]:checked').forEach(input=>{const id=input.name.slice(2);answers[id]=Number(input.value)});
 const {data,error}=await sb.rpc('submit_course_assessment',{p_assessment_id:assessmentId,p_answers:answers});
 if(error){toast('Submission failed: '+error.message,'error');return}
 const host=document.getElementById('learning-student-dashboard');
 host.innerHTML='<div class="learn-course"><h3>Assessment result</h3><p class="learn-meta">Score: <strong>'+Number(data.score_percentage).toFixed(2)+'%</strong> · '+data.correct+'/'+data.total+' correct</p><p>'+(data.passed?'You passed. Well done!':'Not passed yet. Review the lessons and try again.')+'</p><p class="learn-muted">Required pass mark: '+Number(data.pass_percentage)+'%</p><button class="btn bo" onclick="loadLearningDashboard()">Return to dashboard</button></div>';
}
async function requestCourseCertificate(enrollmentId){
 const {data,error}=await sb.rpc('issue_course_certificate',{p_enrollment_id:enrollmentId});
 if(error){toast('Certificate not available yet: '+error.message,'error');return}
 const host=document.getElementById('learning-student-dashboard');
 host.innerHTML='<div class="learn-course"><h3>Certificate issued</h3><p>Your certificate code is <strong>'+escHTML(data.certificate_code)+'</strong></p><p class="learn-muted">Keep this code to verify your certificate.</p><button class="btn bo" onclick="GenUICopyCertificateCode(\''+escHTML(data.certificate_code)+'\')">Copy certificate code</button><button class="btn bo" onclick="loadLearningDashboard()">Return to dashboard</button></div>';
}
function GenUICopyCertificateCode(code){if(navigator.clipboard?.writeText)navigator.clipboard.writeText(code).then(()=>toast('Certificate code copied.','success')).catch(()=>toast('Copy unavailable. Please copy the code manually.'));else toast('Please copy the certificate code manually.');}
async function verifyCourseCertificate(){
 const field=document.getElementById('certificate-verify-code'),result=document.getElementById('certificate-verify-result');if(!field||!result)return;
 const code=field.value.trim();if(!code){result.textContent='Enter a certificate code.';return}
 result.textContent='Checking certificate…';
 const {data,error}=await sb.rpc('verify_course_certificate',{p_certificate_code:code});
 if(error||!data){result.textContent='No matching certificate was found.';return}
 result.textContent=(data.valid?'Valid certificate':'Certificate revoked')+' · '+data.student_name+' · '+data.course_title+' · Issued '+new Date(data.issued_at).toLocaleDateString();
}
