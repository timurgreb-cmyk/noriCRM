// Sound Synth (Web Audio API)
let audioCtx = null;
let soundEnabled = true;

function playBellSound() {
  if (!soundEnabled) return;
  
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const now = audioCtx.currentTime;
    
    // Loud, repeating 3-pulse alarm (Ringtone style: 3 bursts of two-tone chime)
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.45;
      playLoudChime(now + delay);
    }
  } catch (err) {
    console.error('Audio synthesis failed:', err);
  }
}

function playLoudChime(startTime) {
  // Tone 1: 783.99 Hz (G5)
  playToneSegment(783.99, startTime, 0.25, 0.4, 'triangle');
  // Tone 2: 1046.50 Hz (C6) - Loud high chime
  playToneSegment(1046.50, startTime + 0.12, 0.35, 0.5, 'sine');
}

function playToneSegment(freq, startTime, duration, volume, waveType = 'sine') {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = waveType;
  osc.frequency.setValueAtTime(freq, startTime);
  
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// Supabase SDK client placeholder
function parseOrderItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) return parsed;
    } catch(e) {
      console.warn('Could not parse items string:', items);
    }
  }
  return [];
}

let supabaseClient = null;

async function initSupabase() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config API not reachable');
    const config = await res.json();
    
    // window.supabase comes from CDN <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    const supabaseSDK = window.supabase;
    if (config.supabaseUrl && config.supabaseKey && supabaseSDK && supabaseSDK.createClient) {
      supabaseClient = supabaseSDK.createClient(config.supabaseUrl, config.supabaseKey);
      console.log('Supabase initialized successfully!');
      
      await loadRealOrders();
      subscribeToRealtimeOrders();
      return;
    }
  } catch (err) {
    console.warn('Backend API config not available (local testing mode). Running with LocalStorage mock.', err);
  }
}

async function loadRealOrders() {
  if (!supabaseClient) return;
  console.log('Fetching orders from Supabase...');
  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    const fetchedOrders = data || [];
    
    // Детектируем новые заказы при опросе базы
    let hasBrandNewOrder = false;
    fetchedOrders.forEach(newO => {
      if (newO.status === 'new' && !orders.some(existingO => existingO.id === newO.id)) {
        hasBrandNewOrder = true;
      }
    });
    
    orders = fetchedOrders;
    renderBoard();
    updateStats();
    
    if (hasBrandNewOrder) {
      playBellSound();
      showToast('Поступил новый заказ!', 'info');
    }
  } catch (err) {
    console.error('Error loading orders from Supabase:', err);
  }
}

function subscribeToRealtimeOrders() {
  if (!supabaseClient) return;
  console.log('Subscribing to Supabase Realtime orders channel...');
  
  // Автоматический периодический опрос базы каждые 5 секунд как гарантия доставки
  setInterval(loadRealOrders, 5000);

  supabaseClient
    .channel('orders-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
      console.log('New order received via Realtime:', payload.new);
      if (!orders.some(o => o.id === payload.new.id)) {
        orders.unshift(payload.new);
        renderBoard();
        updateStats();
        playBellSound();
        showToast(`Поступил новый заказ #${payload.new.id}!`, 'info');
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
      console.log('Order updated via Realtime:', payload.new);
      const idx = orders.findIndex(o => o.id === payload.new.id);
      if (idx !== -1) {
        orders[idx] = payload.new;
        renderBoard();
        updateStats();
      }
    })
    .subscribe((status) => {
      console.log('Realtime subscription status:', status);
    });
}

// Initial Mock Menu for reference
const mockMenu = [
  { id: 1, name: 'Филадельфия Классик', price: 2490, category: 'Роллы' },
  { id: 2, name: 'Калифорния с крабом', price: 1990, category: 'Роллы' },
  { id: 3, name: 'Дракон Ролл', price: 2890, category: 'Роллы' },
  { id: 4, name: 'Сяке Маки', price: 1290, category: 'Суши' },
  { id: 5, name: 'Coca-Cola 0.5', price: 450, category: 'Напитки' },
  { id: 6, name: 'Соевый соус (доп)', price: 150, category: 'Соусы' }
];

// Seed initial orders if none exist
const DEFAULT_ORDERS = [
  {
    id: 101,
    phone: '+77071234567',
    name: 'Айдос',
    address: 'ул. Достык 42, кв 15',
    items: [
      { id: 1, name: 'Филадельфия Классик', quantity: 2, price: 2490 },
      { id: 5, name: 'Coca-Cola 0.5', quantity: 2, price: 450 }
    ],
    total: 5880,
    status: 'new',
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 mins ago
  },
  {
    id: 102,
    phone: '+77779876543',
    name: 'Мария',
    address: 'пр. Аль-Фараби 77/7, блок А, кв 102',
    items: [
      { id: 3, name: 'Дракон Ролл', quantity: 1, price: 2890 },
      { id: 6, name: 'Соевый соус (доп)', quantity: 2, price: 150 }
    ],
    total: 3190,
    status: 'ready',
    created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString() // 25 mins ago
  },
  {
    id: 103,
    phone: '+77014445566',
    name: 'Тимур',
    address: 'ул. Абая 150, кв 4',
    items: [
      { id: 2, name: 'Калифорния с крабом', quantity: 3, price: 1990 }
    ],
    total: 5970,
    status: 'ready',
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString() // 45 mins ago
  }
];

let orders = [];

function loadOrders() {
  const localData = localStorage.getItem('noricrm_orders');
  if (localData) {
    orders = JSON.parse(localData);
  } else {
    orders = [...DEFAULT_ORDERS];
    saveOrders();
  }
}

function saveOrders() {
  localStorage.setItem('noricrm_orders', JSON.stringify(orders));
}

// Stats Calculation
function updateStats() {
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today);
  
  const countToday = todayOrders.length;
  const completedToday = todayOrders.filter(o => o.status === 'completed');
  
  let totalRevenue = 0;
  completedToday.forEach(o => {
    totalRevenue += o.total;
  });
  
  const avgCheck = countToday > 0 ? Math.round(todayOrders.reduce((sum, o) => sum + o.total, 0) / countToday) : 0;
  
  document.getElementById('stat-orders-today').innerText = countToday;
  document.getElementById('stat-revenue-today').innerText = `${totalRevenue.toLocaleString()} ₸`;
  document.getElementById('stat-avg-check').innerText = `${avgCheck.toLocaleString()} ₸`;
  document.getElementById('stat-completed-today').innerText = completedToday.length;
}

// Generate toast notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  
  container.appendChild(toast);
  
  // Trigger animation next frame
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Remove after 3s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

// Time updater
function startClock() {
  const timeEl = document.getElementById('current-time');
  function updateTime() {
    const now = new Date();
    timeEl.innerText = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// Get relative time (e.g. 5 мин назад)
function getRelativeTimeString(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч назад`;
}

// Render Order Board
function renderBoard() {
  const cols = {
    new: document.getElementById('list-new'),
    ready: document.getElementById('list-ready'),
    completed: document.getElementById('list-completed')
  };
  
  // Clear lists
  Object.values(cols).forEach(col => {
    col.innerHTML = '';
  });
  
  // Update counts
  const counts = { new: 0, ready: 0, completed: 0 };
  
  // Render cards
  // Show newer orders first
  const sortedOrders = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  sortedOrders.forEach(order => {
    if (!cols[order.status]) return;
    
    counts[order.status]++;
    
    const card = document.createElement('div');
    card.className = `order-card ${order.status === 'new' ? 'new-order-pulse' : ''}`;
    card.onclick = (e) => {
      // Don't open details if they clicked an action button
      if (e.target.closest('.btn-card-action')) return;
      openDetails(order.id);
    };
    
    const itemsList = parseOrderItems(order.items);
    const itemsPreview = itemsList.map(it => `${it.quantity || 1}x ${it.name || 'Позиция'}`).join(', ');
    const relativeTime = getRelativeTimeString(order.created_at);
    
    let actionBtn = '';
    if (order.status === 'new') {
      actionBtn = `<button class="btn btn-wasabi btn-card-action" onclick="moveOrderStatus(${order.id}, 'ready')">Принять</button>`;
    } else if (order.status === 'ready') {
      actionBtn = `<button class="btn btn-secondary btn-card-action" onclick="moveOrderStatus(${order.id}, 'completed')">Завершить</button>`;
    }
    
    card.innerHTML = `
      <div class="card-header">
        <span class="order-id">#${order.id}</span>
        <span class="order-time">${relativeTime}</span>
      </div>
      <div class="card-body">
        <span class="customer-name">${order.name}</span>
        <span class="items-preview">${itemsPreview}</span>
      </div>
      <div class="card-footer">
        <span class="order-total">${order.total.toLocaleString()} ₸</span>
        <div class="card-actions">
          ${actionBtn}
        </div>
      </div>
    `;
    
    cols[order.status].appendChild(card);
  });
  
  // Update counts in column headers
  document.getElementById('count-new').innerText = counts.new;
  document.getElementById('count-ready').innerText = counts.ready;
  document.getElementById('count-completed').innerText = counts.completed;
}

// Move order status
window.moveOrderStatus = async function(orderId, newStatus) {
  const statusNames = {
    ready: 'Активные',
    completed: 'Завершенные'
  };

  const order = orders.find(o => o.id === orderId);

  if (supabaseClient) {
    // Оптимистичное обновление для быстрого отклика интерфейса
    const oldStatus = order?.status;
    if (order) order.status = newStatus;
    renderBoard();
    updateStats();
    
    const { error } = await supabaseClient
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);
      
    if (error) {
      console.error('Failed to update order status in Supabase:', error);
      showToast(`Ошибка сохранения: ${error.message}`, 'error');
      // Возвращаем старый статус при ошибке
      if (order && oldStatus) {
        order.status = oldStatus;
        renderBoard();
        updateStats();
      }
    } else {
      showToast(`Заказ #${orderId} переведен в статус: ${statusNames[newStatus] || newStatus}`);
      
      // Отправляем уведомление клиенту в WhatsApp
      if (order && order.phone) {
        fetch('/api/notify-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, phone: order.phone, status: newStatus })
        }).catch(err => console.warn('Status notification error:', err));
      }
    }
  } else {
    // Локальный режим (Mock)
    if (order) order.status = newStatus;
    saveOrders();
    renderBoard();
    updateStats();
    showToast(`Заказ #${orderId} переведен в статус: ${statusNames[newStatus] || newStatus}`);
  }
};

// Clipboard helper
function copyToClipboard(text, fieldName) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${fieldName} скопирован в буфер`);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
}

// Open order details modal
let currentModalOrderId = null;
function openDetails(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  
  currentModalOrderId = orderId;
  
  document.getElementById('modal-order-id').innerText = orderId;
  document.getElementById('detail-name').innerText = order.name;
  
  const phoneEl = document.getElementById('detail-phone');
  phoneEl.innerText = order.phone;
  phoneEl.onclick = () => copyToClipboard(order.phone, 'Номер телефона');
  
  const addressEl = document.getElementById('detail-address');
  addressEl.innerText = order.address;
  addressEl.onclick = () => copyToClipboard(order.address, 'Адрес доставки');
  
  const itemsContainer = document.getElementById('modal-items-list');
  const modalItemsList = parseOrderItems(order.items);
  itemsContainer.innerHTML = modalItemsList.map(it => `
    <div class="modal-item-row">
      <span><span class="item-quantity">${it.quantity || 1}x</span> ${it.name || 'Позиция'}</span>
      <span class="item-price">${((it.quantity || 1) * (it.price || 0)).toLocaleString()} ₸</span>
    </div>
  `).join('');
  
  document.getElementById('modal-total-val').innerText = `${order.total.toLocaleString()} ₸`;
  
  // Custom button behavior for Modal action
  const modalActions = document.getElementById('modal-actions-container');
  modalActions.innerHTML = '';
  
  if (order.status === 'new') {
    modalActions.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Закрыть</button>
      <button class="btn btn-wasabi" onclick="acceptOrderFromModal(${orderId})">Принять заказ</button>
    `;
  } else {
    modalActions.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Закрыть</button>
    `;
  }
  
  document.getElementById('details-modal').classList.add('active');
}

window.closeModal = function() {
  document.getElementById('details-modal').classList.remove('active');
};


window.acceptOrderFromModal = function(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  
  const orderItemsList = parseOrderItems(order.items);
  const orderText = `Заказ #${orderId}
Клиент: ${order.name} (${order.phone})
Адрес: ${order.address}
Состав:
${orderItemsList.map(it => `- ${it.name} x${it.quantity}`).join('\n')}
Итого: ${order.total} ₸`;

  copyToClipboard(orderText, 'Данные заказа');
  moveOrderStatus(orderId, 'ready');
  closeModal();
};

// Simulate sound testing
window.testSound = function() {
  playBellSound();
  showToast('Тестовый звук отправлен');
};

// Toggle Sound
window.toggleSound = function() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('btn-sound-toggle');
  if (soundEnabled) {
    btn.innerHTML = '🔊 Звук: Вкл';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    showToast('Звуковые уведомления включены');
  } else {
    btn.innerHTML = '🔇 Звук: Вкл';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    showToast('Звуковые уведомления отключены', 'info');
  }
};

// Generate Mock Order
window.generateMockOrder = async function() {
  const names = ['Алихан', 'Даурен', 'Аружан', 'Мадина', 'Руслан', 'Сабина'];
  const phones = ['+77028889922', '+77053331144', '+77475556677', '+77074443322'];
  const addresses = ['ул. Назарбаева 220, кв 45', 'пр. Сейфуллина 500, кв 12', 'ул. Жарокова 11, кв 89', 'мкр. Самал-2, д 15'];
  
  // Pick random count of items
  const itemCount = Math.floor(Math.random() * 3) + 1;
  const items = [];
  let total = 0;
  
  for (let i = 0; i < itemCount; i++) {
    const menuItem = mockMenu[Math.floor(Math.random() * mockMenu.length)];
    // Check if item already added
    const existing = items.find(it => it.id === menuItem.id);
    const quantity = Math.floor(Math.random() * 2) + 1;
    
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({
        id: menuItem.id,
        name: menuItem.name,
        quantity: quantity,
        price: menuItem.price
      });
    }
  }
  
  items.forEach(it => {
    total += it.price * it.quantity;
  });
  
  const newOrder = {
    phone: phones[Math.floor(Math.random() * phones.length)],
    name: names[Math.floor(Math.random() * names.length)],
    address: addresses[Math.floor(Math.random() * addresses.length)],
    items: items,
    total: total,
    status: 'new',
    created_at: new Date().toISOString()
  };

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('orders')
      .insert([newOrder])
      .select();
      
    if (error) {
      console.error('Failed to insert order into Supabase:', error);
      // Fallback to local UI adding so cashier can test seamlessly
      const newId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 101;
      newOrder.id = newId;
      orders.unshift(newOrder);
      renderBoard();
      updateStats();
      playBellSound();
      showToast(`Тестовый заказ #${newId} создан локально`, 'info');
    } else {
      console.log('Order successfully inserted into Supabase:', data);
      await loadRealOrders();
      playBellSound();
      showToast('Новый заказ создан в Supabase!', 'success');
    }
  } else {
    // Локальный режим (Mock)
    const newId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 101;
    newOrder.id = newId;
    orders.unshift(newOrder);
    saveOrders();
    renderBoard();
    updateStats();
    playBellSound();
    showToast(`Поступил новый заказ #${newId}!`, 'info');
  }
};

// AI Chat Simulation Modal Logic
window.openChatModal = function() {
  document.getElementById('chat-modal').classList.add('active');
  const input = document.getElementById('chat-modal-input');
  if (input) input.focus();
};

window.closeChatModal = function() {
  document.getElementById('chat-modal').classList.remove('active');
};

const modalChatPhone = '+77071234567';
window.sendModalChatMessage = async function() {
  const input = document.getElementById('chat-modal-input');
  const text = input.value.trim();
  if (!text) return;
  
  const box = document.getElementById('modal-chat-box');
  
  const userDiv = document.createElement('div');
  userDiv.style.cssText = 'align-self: flex-end; background: #e3f2fd; color: #0d47a1; padding: 0.6rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.9rem; max-width: 80%; line-height: 1.4;';
  userDiv.innerHTML = `<b>Вы:</b> ${text}`;
  box.appendChild(userDiv);
  
  input.value = '';
  box.scrollTop = box.scrollHeight;
  
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'align-self: flex-start; background: #f1f8e9; color: #33691e; padding: 0.6rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.9rem; max-width: 80%; font-style: italic;';
  loadingDiv.innerText = 'ИИ печатает...';
  box.appendChild(loadingDiv);
  box.scrollTop = box.scrollHeight;

  try {
    const res = await fetch('/api/test-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: modalChatPhone, message: text })
    });
    
    const data = await res.json();
    loadingDiv.remove();
    
    const botDiv = document.createElement('div');
    botDiv.style.cssText = 'align-self: flex-start; background: #f1f8e9; color: #1b5e20; padding: 0.6rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.9rem; max-width: 85%; line-height: 1.4; white-space: pre-wrap;';
    
    if (data.reply) {
      let replyHtml = `<b>Nori AI:</b> ${data.reply}`;
      if (data.voiceText) {
        replyHtml = `<div style="margin-bottom: 0.4rem; background: #fff3e0; border: 1px solid #ffe0b2; padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.8rem; color: #e65100;">🎙️ <b>Транскрибация голоса ИИ:</b> "${data.voiceText}"</div>` + replyHtml;
      }
      if (data.pdfSent) {
        replyHtml += `<div style="margin-top: 0.5rem; background: #e8f5e9; border: 1px solid #81c784; padding: 0.5rem 0.8rem; border-radius: 8px; font-size: 0.85rem; color: #2e7d32; display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.2rem;">📄</span>
          <div>
            <b>2026_меню.pdf</b>
            <div style="font-size: 0.75rem; color: #555;">4 страницы • PDF (Отправка файла в WhatsApp)</div>
          </div>
        </div>`;
      }
      if (data.requiresHuman) {
        replyHtml += `<div style="margin-top: 0.5rem; background: #ffebee; border: 1px solid #ef5350; padding: 0.5rem 0.8rem; border-radius: 8px; font-weight: bold; color: #c62828;">⚠️ ЗАПРОС ОПЕРАТОРА: ЧАТ ПЕРЕДАН КАССИРУ (ИИ ПРИОСТАНОВЛЕН)!</div>`;
        playBellSound();
        showToast('⚠️ Клиент в WhatsApp просит человека!', 'error');
      }
      if (data.receiptVerified) {
        replyHtml += `<div style="margin-top: 0.5rem; background: #e8f5e9; border: 1px solid #4caf50; padding: 0.5rem 0.8rem; border-radius: 8px; font-weight: bold; color: #2e7d32;">✅ ЧЕК KASPI РАСПОЗНАН И ОПЛАТА ПОДТВЕРЖДЕНА!</div>`;
        if (supabaseClient) loadRealOrders();
      }
      if (data.orderCreated) {
        replyHtml += `<div style="margin-top: 0.5rem; background: var(--color-wasabi-bg); border: 1px solid var(--color-wasabi); padding: 0.4rem; border-radius: 6px; font-weight: bold; color: var(--color-wasabi);">🎉 ЗАКАЗ УСПЕШНО СОЗДАН В БАЗЕ!</div>`;
        if (supabaseClient) loadRealOrders();
      }
      botDiv.innerHTML = replyHtml;
    } else {
      botDiv.innerHTML = `<b style="color:red">Ошибка:</b> ${data.error || 'Не удалось получить ответ ИИ'}`;
    }
    box.appendChild(botDiv);
  } catch (err) {
    loadingDiv.remove();
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'align-self: flex-start; background: #ffebee; color: #c62828; padding: 0.6rem 0.9rem; border-radius: 12px; font-size: 0.85rem;';
    errDiv.innerText = `Ошибка соединения: ${err.message}`;
    box.appendChild(errDiv);
  }
  
  box.scrollTop = box.scrollHeight;
};

window.sendSimulatedKaspiReceipt = async function() {
  const box = document.getElementById('modal-chat-box');
  
  const userDiv = document.createElement('div');
  userDiv.style.cssText = 'align-self: flex-end; background: #e3f2fd; color: #0d47a1; padding: 0.6rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.9rem; max-width: 80%; line-height: 1.4;';
  userDiv.innerHTML = `<b>Вы:</b> 📎 <i>[Прикреплен чек Kaspi PDF]</i>`;
  box.appendChild(userDiv);
  box.scrollTop = box.scrollHeight;

  const input = document.getElementById('chat-modal-input');
  input.value = 'Вот чек об оплате';
  await sendModalChatMessage();
};

window.sendSimulatedVoiceNote = async function() {
  const box = document.getElementById('modal-chat-box');
  
  const userDiv = document.createElement('div');
  userDiv.style.cssText = 'align-self: flex-end; background: #e3f2fd; color: #0d47a1; padding: 0.6rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.9rem; max-width: 80%; line-height: 1.4;';
  userDiv.innerHTML = `<b>Вы:</b> 🎙️ <i>[Голосовое сообщение 0:12]</i>`;
  box.appendChild(userDiv);
  box.scrollTop = box.scrollHeight;

  const input = document.getElementById('chat-modal-input');
  input.value = 'Салеметсизбе! Маған Семейный сет пен два соуса керек. Асыл Арман 12 дом 45 кв';
  await sendModalChatMessage();
};

window.sendSimulatedHumanRequest = async function() {
  const input = document.getElementById('chat-modal-input');
  input.value = 'Позовите человека, у меня вопрос по заказу';
  await sendModalChatMessage();
};

// WhatsApp Manager Panel Logic for Cashier
let currentSelectedPhone = null;
let conversationsList = [];

window.openWhatsAppChatsModal = function() {
  document.getElementById('whatsapp-chats-modal').classList.add('active');
  loadWhatsAppConversations();
};

window.closeWhatsAppChatsModal = function() {
  document.getElementById('whatsapp-chats-modal').classList.remove('active');
};

async function loadWhatsAppConversations() {
  const threadsBox = document.getElementById('whatsapp-threads-list');
  if (!supabaseClient) {
    threadsBox.innerHTML = `<div style="padding: 1rem; color: #888; font-size: 0.85rem;">БД не подключена. Переписка доступна в онлайн-режиме.</div>`;
    return;
  }

  try {
    const { data: convs, error } = await supabaseClient
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      threadsBox.innerHTML = `<div style="padding: 1rem; color: red; font-size: 0.85rem;">Ошибка: ${error.message}</div>`;
      return;
    }

    conversationsList = convs || [];
    
    // Update unread / attention count badge in header
    const attentionCount = conversationsList.filter(c => c.requires_human || c.is_human_takeover).length;
    const badge = document.getElementById('whatsapp-unread-badge');
    if (badge) {
      if (attentionCount > 0) {
        badge.innerText = attentionCount;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (conversationsList.length === 0) {
      threadsBox.innerHTML = `<div style="padding: 1rem; color: #888; font-size: 0.85rem; text-align: center;">Нет активных диалогов</div>`;
      return;
    }

    threadsBox.innerHTML = conversationsList.map(c => {
      const messages = c.messages || [];
      const lastMsg = messages.length > 0 ? messages[messages.length - 1].content : '';
      const isSelected = c.phone === currentSelectedPhone;
      const isHumanNeeded = c.requires_human || c.is_human_takeover;

      return `
        <div onclick="selectWhatsAppThread('${c.phone}')" style="padding: 0.8rem; border-bottom: 1px solid rgba(22,38,28,0.06); cursor: pointer; background: ${isSelected ? '#e8f5e9' : 'transparent'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.2rem;">
            <b style="font-size: 0.9rem; color: #16261c;">${c.phone}</b>
            ${isHumanNeeded ? `<span style="background: #ffebee; color: #c62828; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: bold;">⚠️ Требуется оператор</span>` : `<span style="background: #e8f5e9; color: #2e7d32; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">🤖 ИИ Авто-ответ</span>`}
          </div>
          <div style="font-size: 0.8rem; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${lastMsg || 'Диалог начат'}
          </div>
        </div>
      `;
    }).join('');

    if (currentSelectedPhone) {
      selectWhatsAppThread(currentSelectedPhone);
    } else if (conversationsList.length > 0) {
      selectWhatsAppThread(conversationsList[0].phone);
    }

  } catch (err) {
    threadsBox.innerHTML = `<div style="padding: 1rem; color: red; font-size: 0.85rem;">Ошибка: ${err.message}</div>`;
  }
}

window.selectWhatsAppThread = function(phone) {
  currentSelectedPhone = phone;
  const c = conversationsList.find(item => item.phone === phone);
  const detailBox = document.getElementById('whatsapp-chat-detail');

  if (!c) {
    detailBox.innerHTML = `<div style="padding: 2rem; color: #888; margin: auto;">Диалог не найден</div>`;
    return;
  }

  const messages = c.messages || [];
  const isHumanActive = c.is_human_takeover;

  let messagesHtml = messages.map(m => {
    const isUser = m.role === 'user';
    return `
      <div style="align-self: ${isUser ? 'flex-start' : 'flex-end'}; background: ${isUser ? '#f1f8e9' : '#e3f2fd'}; color: ${isUser ? '#1b5e20' : '#0d47a1'}; padding: 0.6rem 0.9rem; border-radius: 12px; font-size: 0.88rem; max-width: 80%; line-height: 1.4; white-space: pre-wrap;">
        <b>${isUser ? 'Клиент' : 'Оператор'}:</b> ${m.content}
      </div>
    `;
  }).join('');

  detailBox.innerHTML = `
    <!-- Thread Header -->
    <div style="padding: 0.8rem 1rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">
      <div>
        <b style="font-size: 1rem;">📱 ${c.phone}</b>
        <div style="font-size: 0.75rem; color: #777;">Режим: ${isHumanActive ? '<span style="color:#c62828; font-weight:bold;">Ручное управление кассира</span>' : '<span style="color:#2e7d32;">ИИ Бот работает</span>'}</div>
      </div>
      <div>
        ${isHumanActive ? `<button class="btn btn-wasabi" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;" onclick="resumeAiInThread('${c.phone}')">🤖 Включить ИИ Бот</button>` : `<button class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;" onclick="takeoverThread('${c.phone}')">✋ Перехватить диалог</button>`}
      </div>
    </div>

    <!-- Chat Messages Box -->
    <div id="cashier-chat-history" style="flex: 1; padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; background: #fdfdfd;">
      ${messagesHtml || '<div style="color: #999; text-align: center;">Сообщений нет</div>'}
    </div>

    <!-- Footer Input for Cashier Reply -->
    <div style="padding: 0.8rem; border-top: 1px solid #eee; display: flex; gap: 0.5rem; background: #fff;">
      <input type="text" id="cashier-reply-input" placeholder="Напишите ответ клиенту от лица оператора..." style="flex: 1; padding: 0.65rem 0.9rem; border-radius: 8px; border: 1px solid #ccc; font-size: 0.9rem;" onkeypress="if(event.key==='Enter') sendCashierReplyToWhatsApp('${c.phone}')" />
      <button class="btn btn-primary" onclick="sendCashierReplyToWhatsApp('${c.phone}')">Отправить</button>
    </div>
  `;

  const historyBox = document.getElementById('cashier-chat-history');
  if (historyBox) historyBox.scrollTop = historyBox.scrollHeight;
};

window.takeoverThread = async function(phone) {
  if (!supabaseClient) return;
  await supabaseClient.from('conversations').update({ is_human_takeover: true, requires_human: true }).eq('phone', phone);
  showToast('Вы перехватили управление чатом', 'info');
  loadWhatsAppConversations();
};

window.resumeAiInThread = async function(phone) {
  if (!supabaseClient) return;
  await supabaseClient.from('conversations').update({ is_human_takeover: false, requires_human: false }).eq('phone', phone);
  showToast('ИИ-бот снова отвечает на сообщения клиента', 'info');
  loadWhatsAppConversations();
};

window.sendCashierReplyToWhatsApp = async function(phone) {
  const input = document.getElementById('cashier-reply-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const c = conversationsList.find(item => item.phone === phone);
  if (!c) return;

  const updatedMessages = [
    ...(c.messages || []),
    { role: 'assistant', content: text }
  ];

  if (supabaseClient) {
    await supabaseClient.from('conversations').update({
      messages: updatedMessages,
      is_human_takeover: true,
      requires_human: false,
      updated_at: new Date().toISOString()
    }).eq('phone', phone);
  }

  input.value = '';
  showToast(`Сообщение отправлено клиенту ${phone}`);
  loadWhatsAppConversations();
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initSupabase().then(() => {
    if (!supabaseClient) {
      loadOrders();
      updateStats();
      renderBoard();
    }
  });
  startClock();
  
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker registered successfully', reg.scope))
        .catch(err => console.log('ServiceWorker registration failed: ', err));
    });
  }
  
  // Click outside modal to close
  document.getElementById('details-modal').onclick = (e) => {
    if (e.target === document.getElementById('details-modal')) {
      closeModal();
    }
  };

  document.getElementById('whatsapp-chats-modal').onclick = (e) => {
    if (e.target === document.getElementById('whatsapp-chats-modal')) {
      closeWhatsAppChatsModal();
    }
  };
  
  // Recalculate relative times every minute
  setInterval(renderBoard, 60000);
  // Auto refresh WhatsApp threads list every 10 seconds if modal open
  setInterval(() => {
    const modal = document.getElementById('whatsapp-chats-modal');
    if (modal && modal.classList.contains('active')) {
      loadWhatsAppConversations();
    }
  }, 10000);
});
