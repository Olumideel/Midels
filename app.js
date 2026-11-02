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
  if (pass.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

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
  if (!password || password.length < 6) {
    toast('Your new password must be at least 6 characters.', 'error');
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
  STATE.activeChatUserId = null;
  closeChat(); closeChatList(); closeFriendsPanel();
  onLoggedOutUI();
  toast('You have been logged out.', '');
}

function onLoggedOutUI() {
  document.getElementById('nav-social-icons').style.display = 'none';
  document.getElementById('mobile-profile-link').style.display = 'none';
  document.getElementById('nav-login-btn').style.display = '';
  document.getElementById('nav-signup-btn').style.display = '';
  document.getElementById('nav-logout-btn').style.display = 'none';
  renderChefGrid(STATE.profiles);
}

async function onLogin() {
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
      toast('Payment verified. Your subscription is now active.', 'success');
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
  document.getElementById('recipe-modal').classList.add('op');
}
function closeRecipeComposer() {
  document.getElementById('recipe-modal')?.classList.remove('op');
}
async function submitRecipe(event) {
  event.preventDefault();
  if (!STATE.currentUser) {
    closeRecipeComposer();
    openAuth('login');
    return;
  }

  const title = document.getElementById('recipe-title').value.trim();
  const ingredients = document.getElementById('recipe-ingredients').value
    .split('\n').map(line => line.trim()).filter(Boolean);
  const instructions = document.getElementById('recipe-instructions').value
    .split('\n').map(line => line.trim()).filter(Boolean);
  const imageInput = document.getElementById('recipe-image').value.trim();
  let imageUrl = null;

  if (!title || !ingredients.length || !instructions.length) {
    toast('Add a title, ingredients and cooking instructions.', 'error');
    return;
  }
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

  const integerValue = id => {
    const value = Number(document.getElementById(id).value);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  };
  const tags = document.getElementById('recipe-tags').value
    .split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const payload = {
    author_id: STATE.currentUser.id,
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
    tags,
    is_published: true
  };

  const button = document.getElementById('recipe-submit');
  button.disabled = true;
  button.textContent = 'Publishing…';
  const { error } = await sb.from('recipes').insert(payload);
  button.disabled = false;
  button.textContent = 'Publish recipe';
  if (error) {
    console.error('Recipe publishing failed:', error);
    toast(error.message || 'Your recipe could not be published.', 'error');
    return;
  }

  document.getElementById('recipe-form').reset();
  closeRecipeComposer();
  await loadPublicRecipes();
  await loadPlatformStats();
  toast('Your recipe is now published in the community.', 'success');
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
    .select('id,author_id,title,description,image_url,cuisine,category,difficulty,prep_minutes,cook_minutes,servings,tags,created_at')
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
      .select('id,full_name,display_name')
      .in('id', authorIds);
    if (!profileError) authors = profiles || [];
  }
  const authorMap = new Map(authors.map(profile => [
    profile.id,
    profile.display_name || profile.full_name || 'Community chef'
  ]));

  liveRecipes = (data || []).map(recipe => ({
    ...recipe,
    chef: authorMap.get(recipe.author_id) || 'Community chef',
    tags: Array.isArray(recipe.tags) ? recipe.tags : []
  }));
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
    return '<article class="rcard"><div class="rcard-img">' + image +
      '<span class="rbadge">' + escHTML(recipe.difficulty || recipe.cuisine || 'Community recipe') + '</span></div>' +
      '<div class="rcard-body"><div class="rcard-title">' + escHTML(recipe.title) + '</div>' +
      '<div class="rcard-chef">by ' + escHTML(recipe.chef) + '</div>' +
      '<div class="rcard-meta"><span>⏱ ' + escHTML(time) + '</span>' +
      (recipe.servings ? '<span> · Serves ' + Number(recipe.servings) + '</span>' : '') + '</div>' +
      (recipe.description ? '<p class="rcard-description">' + escHTML(recipe.description) + '</p>' : '') +
      '<div class="rcard-tags">' + tags + '</div></div></article>';
  }).join('');
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
