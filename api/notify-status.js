// Green-API Status Notification Route

async function sendWhatsAppMessage(chatId, message) {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;

  if (!instanceId || !token) {
    console.warn('[Green-API] Instance ID or Token missing in process.env');
    return false;
  }

  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });

    const data = await response.json();
    console.log('[Green-API] Status notification response:', data);
    return true;
  } catch (err) {
    console.error('[Green-API] Error sending status notification:', err);
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderId, phone, status } = req.body || {};

    if (!orderId || !phone || !status) {
      return res.status(400).json({ error: 'orderId, phone, and status are required' });
    }

    // Format phone to WhatsApp chatId if needed
    let chatId = phone;
    if (!chatId.includes('@c.us')) {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      chatId = `${cleanPhone}@c.us`;
    }

    let messageText = '';
    if (status === 'ready' || status === 'accepted') {
      messageText = `🎉 Ваш заказ #${orderId} принят кассиром и успешно оформлен! Мы уже собираем его и передадим курьеру. Спасибо за заказ в Nori! 🍣`;
    } else if (status === 'completed') {
      messageText = `✅ Ваш заказ #${orderId} выполнен и доставлен! Приятного аппетита! Будем рады вашему отзыву и новому заказу в Nori! 🍣`;
    } else {
      messageText = `Статус вашего заказа #${orderId} обновлен: ${status}. С уважением, суши-бар Nori! 🍣`;
    }

    const sent = await sendWhatsAppMessage(chatId, messageText);

    return res.status(200).json({
      success: true,
      sent: sent,
      orderId: orderId,
      message: messageText
    });

  } catch (err) {
    console.error('Error in notify-status:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
