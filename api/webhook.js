const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Initialize Gemini client
function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// Green-API Sender helper
async function sendWhatsAppMessage(chatId, message) {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;

  if (!instanceId || !token) {
    console.warn('[Green-API] Instance ID or Token missing in process.env');
    return false;
  }

  const url = `https://7107.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message })
    });

    const data = await response.json();
    console.log('[Green-API] Message sent response:', data);
    return true;
  } catch (err) {
    console.error('[Green-API] Error sending message:', err);
    return false;
  }
}

module.exports = async (req, res) => {
  // CORS Configuration
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
    const body = req.body || {};
    
    // Check if webhook is incoming message
    if (body.typeWebhook && body.typeWebhook !== 'incomingMessageReceived') {
      return res.status(200).json({ status: 'ignored_webhook_type', type: body.typeWebhook });
    }

    const senderData = body.senderData || {};
    const messageData = body.messageData || {};

    const chatId = senderData.chatId || senderData.sender;
    if (!chatId) {
      return res.status(200).json({ status: 'no_chat_id' });
    }

    const phone = chatId.replace('@c.us', '').replace('@g.us', '');
    
    // Ignore group chats automatically
    if (chatId.includes('@g.us')) {
      return res.status(200).json({ status: 'ignored_group_chat' });
    }

    // White-list filter (optional): if ALLOWED_PHONES is set, bot will ONLY reply to listed numbers
    const allowedPhonesStr = process.env.ALLOWED_PHONES || '';
    if (allowedPhonesStr.trim()) {
      const allowedDigitsList = allowedPhonesStr.split(',').map(p => p.trim().replace(/\D/g, '').slice(-9));
      const incomingDigits = phone.replace(/\D/g, '').slice(-9);
      if (incomingDigits && !allowedDigitsList.includes(incomingDigits)) {
        console.log(`Phone ${phone} (${incomingDigits}) not in ALLOWED_PHONES list (${allowedPhonesStr}). Bot ignored message.`);
        return res.status(200).json({ status: 'phone_not_allowed', phone });
      }
    }
    let mediaPart = null;

    if (messageData.typeMessage === 'textMessage') {
      text = messageData.textMessageData?.textMessage || '';
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      text = messageData.extendedTextMessageData?.text || '';
    } else if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'voiceMessage') {
      const downloadUrl = messageData.fileMessageData?.downloadUrl;
      if (downloadUrl) {
        try {
          const audioResp = await fetch(downloadUrl);
          const arrayBuf = await audioResp.arrayBuffer();
          mediaPart = {
            inlineData: {
              mimeType: 'audio/ogg',
              data: Buffer.from(arrayBuf).toString('base64')
            }
          };
          text = '[Голосовое сообщение]';
        } catch (err) {
          console.error('Error fetching voice message:', err);
        }
      }
    } else if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'documentMessage') {
      const downloadUrl = messageData.fileMessageData?.downloadUrl;
      const fileName = messageData.fileMessageData?.fileName || 'document';
      const isPdf = fileName.toLowerCase().endsWith('.pdf') || messageData.typeMessage === 'documentMessage';
      const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
      
      if (downloadUrl) {
        try {
          const fileResp = await fetch(downloadUrl);
          const arrayBuf = await fileResp.arrayBuffer();
          mediaPart = {
            inlineData: {
              mimeType: mimeType,
              data: Buffer.from(arrayBuf).toString('base64')
            }
          };
          text = '[Чек/Квитанция Kaspi]';
        } catch (err) {
          console.error('Error fetching image/document:', err);
        }
      }
    }

    if (!text.trim() && !mediaPart) {
      return res.status(200).json({ status: 'empty_message' });
    }

    const supabase = getSupabase();
    const ai = getGemini();

    if (!supabase) {
      return res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY missing' });
    }
    if (!ai) {
      return res.status(500).json({ error: 'GEMINI_API_KEY missing' });
    }

    // 1. Fetch existing conversation or init new
    let { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    // Check if human takeover is active
    if (conv && conv.is_human_takeover) {
      console.log(`Human takeover active for ${phone}. Bot remains silent.`);
      return res.status(200).json({ status: 'human_takeover_active' });
    }

    let messages = conv ? (conv.messages || []) : [];

    // Check for explicit trigger words for human operator
    const lowerText = text.toLowerCase();
    const humanTrigger = /(человек|оператор|админ|менеджер|позови|свяжи|жалоба|ошибка в чеке|адам|операторды)/i.test(lowerText);
    
    if (humanTrigger) {
      const takeoverReply = lowerText.includes('адам') || lowerText.includes('операторды')
        ? "Секунд, операторға бағыттадым."
        : "Минутку, передаю диалог администратору.";

      const updatedMessages = [
        ...messages,
        { role: 'user', content: text },
        { role: 'assistant', content: takeoverReply }
      ];

      if (conv) {
        await supabase.from('conversations').update({
          messages: updatedMessages,
          is_human_takeover: true,
          requires_human: true,
          updated_at: new Date().toISOString()
        }).eq('phone', phone);
      } else {
        await supabase.from('conversations').insert([{
          phone: phone,
          messages: updatedMessages,
          is_human_takeover: true,
          requires_human: true
        }]);
      }

      await sendWhatsAppMessage(chatId, takeoverReply);
      return res.status(200).json({ status: 'escalated_to_human', reply: takeoverReply });
    }

    // 2. Fetch available menu items
    const { data: menuData } = await supabase.from('menu').select('name, price, category').eq('is_available', true);
    const menuFormatted = (menuData || []).map(item => `- ${item.name}: ${item.price}₸`).join('\n');

    // 3. System Instructions for Gemini
    const systemInstruction = `Ты — оператор доставки суши и пиццы "Nori / Sushi City" в ЖК «Асыл Арман». Твоя цель — отвечать КРАЙНЕ коротко, четко и по-человечески, ровно так, как реально переписываются администраторы в WhatsApp.

ПРИМЕРЫ НАСТОЯЩИХ ОТВЕТОВ ИЗ ЧАТА:
- Казахский привет / просьба меню: "Саламатсыз ба! Мәзірді жібердім [SEND_MENU_PDF]"
- Русский привет / просьба меню: "Здравствуйте! Вот наше меню [SEND_MENU_PDF]"
- Запрос адреса: "Адрес?" или "Қай адрес?"
- Выставление счета: "7390 тг. Оплата наличными или каспи Голдом +7(707)3767650 Айгерм А. Чек жібере аласыз ба?"
- Подтверждение: "Кабылданды" или "Принято! Ожидание 30-40 минут."

ПРАВИЛА ОБЩЕНИЯ:
1. БЕЗ ЭМОДЗИ: 0 смайликов. Вообще никаких эмодзи.
2. ЯЗЫК: Строго на языке клиента (русский или казахский).
3. СТИЛЬ: 1-2 ультра-коротких предложения! Без лишних длинных речей.
4. ГОЛОСОВЫЕ СООБЩЕНИЯ: Клиент может прислать голосовое сообщение. Внимательно и с высочайшей точностью транскрибируй его устную речь (на казахском или русском). Выдели позиции из меню, имя и адрес. В ответ включи текстовую расшифровку [VOICE_TEXT: "...расшифровка..."] и лаконичный ответ оператора.
5. ЧЕКИ И КВИТАНЦИИ KASPI (ФОТО ИЛИ PDF):
   - Если клиент прислал документ или фото чека Kaspi — внимательно распознай его.
   - Найди сумму перевода (₸), ФИО отправителя или получателя, дату и статус ("Успешно" / "Перевод отправлен").
   - Если чек действителен — ответь лаконично: "Чек получен, спасибо! Передал на кухню." и добавь JSON блок:
\`\`\`json
{
  "receipt_verified": true,
  "paid_amount": 7390
}
\`\`\`

6. ЗАПРОС ОПЕРАТОРА / ЧЕЛОВЕКА:
Если клиент просит позвать человека, жалуется или задает нештатный вопрос — ответь "Минутку, передаю диалог администратору." и добавь JSON блок:
\`\`\`json
{
  "requires_human": true
}
\`\`\`

6. РЕКВИЗИТЫ KASPI: При расчете суммы заказов пиши реквизиты Kaspi:
   "Оплата наличными или каспи Голдом +7(707)3767650 Айгерм А"
7. СРОКИ ДОСТАВКИ:
   - ЖК «Асыл Арман»: 30-40 минут.
   - Поселки (Иргели, Кемертоган, Коксай, Абай, Булакты, Райымбек, Теректы): 1-1.5 часа.
8. МЕНЮ И ЦЕНЫ: Используй ТОЛЬКО официальные цены:
${menuFormatted}

9. ОФОРМЛЕНИЕ (СКРЫТЫЙ JSON):
Когда клиент согласился, назвал адрес и сформировал заказ:
Ответь кратко ("Кабылданды" или "Принято!") и В САМОМ КОНЦЕ ответа прикрепи блок JSON:
\`\`\`json
{
  "order_complete": true,
  "name": "Имя",
  "address": "Адрес",
  "items": [
    {"id": 1, "name": "Название из меню", "quantity": 1, "price": 2490}
  ],
  "total": 2490
}
\`\`\`
Пока заказ не подтвержден, этот JSON блок ставить НЕЛЬЗЯ!`;

    // 4. Convert history to Gemini contents format
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    if (mediaPart) {
      contents.push({
        role: 'user',
        parts: [mediaPart, { text: 'Клиент прислал этот файл/аудио. Если это чек/квитанция Kaspi — распознай сумму и подтверди чек (receipt_verified: true, paid_amount: ...). Если голосовое — расшифруй.' }]
      });
    } else {
      contents.push({
        role: 'user',
        parts: [{ text: text }]
      });
    }

    // 5. Generate content using Gemini API (with robust multi-model fallback)
    let response;
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.7
          }
        });
        if (response && response.text) break;
      } catch (err) {
        console.warn(`Model ${modelName} error, trying fallback...`, err.message);
        lastError = err;
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

    const rawBotReply = response.text || 'К сожалению, возникла ошибка. Попробуйте написать еще раз.';

    // 6. Parse for completed order JSON, Receipt confirmation JSON, or Human escalation JSON
    let cleanBotReply = rawBotReply;
    let orderData = null;
    let receiptData = null;
    let requiresHumanData = null;

    let jsonMatch = rawBotReply.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let jsonStr = jsonMatch ? jsonMatch[1] : null;

    if (!jsonStr) {
      const rawMatch = rawBotReply.match(/\{[\s\S]*?"(order_complete|receipt_verified|requires_human)"\s*:\s*true[\s\S]*?\}/);
      if (rawMatch) jsonStr = rawMatch[0];
    }

    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr.trim());
        if (parsed) {
          if (parsed.order_complete || parsed.items) {
            orderData = parsed;
          }
          if (parsed.receipt_verified) {
            receiptData = parsed;
          }
          if (parsed.requires_human) {
            requiresHumanData = parsed;
          }
          cleanBotReply = rawBotReply
            .replace(/```(?:json)?\s*[\s\S]*?\s*```/gi, '')
            .replace(/\{[\s\S]*?"(order_complete|receipt_verified|requires_human)"\s*:\s*true[\s\S]*?\}/g, '')
            .trim();
        }
      } catch (e) {
        console.error('JSON parse error:', e);
      }
    }

    // 7. If receipt verified, update existing order status to 'paid'
    if (receiptData) {
      const { data: existingOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingOrders && existingOrders.length > 0) {
        const latestOrder = existingOrders[0];
        await supabase
          .from('orders')
          .update({ status: 'ready' })
          .eq('id', latestOrder.id);
        console.log(`Order #${latestOrder.id} marked as PAID via Kaspi receipt!`);
      }
    }

    // 8. If order complete, create row in Supabase 'orders'
    if (orderData) {
      const { data: insertedOrder, error: orderErr } = await supabase
        .from('orders')
        .insert([{
          phone: phone,
          name: orderData.name || 'Клиент WhatsApp',
          address: orderData.address || 'Самовывоз / Уточнить',
          items: orderData.items || [],
          total: orderData.total || 0,
          status: 'new'
        }])
        .select();

      if (orderErr) {
        console.error('Error creating order in Supabase:', orderErr);
      } else {
        console.log('Order created successfully in Supabase:', insertedOrder);
      }
    }


    // 8. Save updated conversation history
    const updatedMessages = [
      ...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: cleanBotReply }
    ];

    const isHumanNeeded = !!requiresHumanData;

    if (conv) {
      await supabase
        .from('conversations')
        .update({
          messages: updatedMessages,
          requires_human: isHumanNeeded ? true : (conv.requires_human || false),
          is_human_takeover: isHumanNeeded ? true : (conv.is_human_takeover || false),
          updated_at: new Date().toISOString()
        })
        .eq('phone', phone);
    } else {
      await supabase
        .from('conversations')
        .insert([{
          phone: phone,
          messages: updatedMessages,
          requires_human: isHumanNeeded,
          is_human_takeover: isHumanNeeded
        }]);
    }

    let shouldSendPdf = false;
    if (cleanBotReply.includes('[SEND_MENU_PDF]')) {
      shouldSendPdf = true;
      cleanBotReply = cleanBotReply.replace(/\[SEND_MENU_PDF\]/g, '').trim();
    }

    // 9. Send text message back to WhatsApp
    await sendWhatsAppMessage(chatId, cleanBotReply);

    // 10. Send PDF file via Green-API if requested
    if (shouldSendPdf) {
      const pdfUrl = process.env.PUBLIC_MENU_PDF_URL || 'https://noricrm.vercel.app/menu.pdf';
      await sendWhatsAppFile(chatId, pdfUrl, '2026_меню.pdf', 'Біздің мәзір 📄');
    }

    return res.status(200).json({
      status: 'success',
      reply: cleanBotReply,
      pdfSent: shouldSendPdf,
      orderCreated: !!orderData
    });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

async function sendWhatsAppFile(chatId, fileUrl, fileName, caption) {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const apiToken = process.env.GREEN_API_TOKEN;
  if (!instanceId || !apiToken) return;

  try {
    const url = `https://7107.api.greenapi.com/waInstance${instanceId}/sendFileByUrl/${apiToken}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: chatId,
        urlFile: fileUrl,
        fileName: fileName,
        caption: caption
      })
    });
  } catch (err) {
    console.error('Green-API sendFileByUrl error:', err);
  }
}
