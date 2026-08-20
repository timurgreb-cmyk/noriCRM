const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>noriCRM AI Bot Simulator</title>
        <style>
          body { font-family: sans-serif; max-width: 600px; margin: 2rem auto; padding: 1rem; background: #faf9f6; }
          #chat { border: 1px solid #ccc; height: 350px; overflow-y: auto; padding: 1rem; background: #fff; border-radius: 8px; margin-bottom: 1rem; }
          .msg { margin-bottom: 0.8rem; padding: 0.5rem 0.8rem; border-radius: 6px; }
          .user { background: #e3f2fd; text-align: right; }
          .bot { background: #f1f8e9; }
          input, button { padding: 0.6rem; font-size: 1rem; }
          input { width: 70%; }
        </style>
      </head>
      <body>
        <h2>🍣 noriCRM AI Bot Simulator</h2>
        <p>Тестовый эмулятор диалога ИИ-консультанта Gemini 2.5 Flash</p>
        <div id="chat"></div>
        <input type="text" id="userInput" placeholder="Напишите сообщение (на русском или казахском)..." onkeydown="if(event.key==='Enter') send()"/>
        <button onclick="send()">Отправить</button>
        
        <script>
          const phone = '+77071234567';
          async function send() {
            const input = document.getElementById('userInput');
            const text = input.value.trim();
            if (!text) return;
            
            const chat = document.getElementById('chat');
            chat.innerHTML += '<div class="msg user"><b>Вы:</b> ' + text + '</div>';
            input.value = '';
            chat.scrollTop = chat.scrollHeight;
            
            try {
              const res = await fetch('/api/test-chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ phone, message: text })
              });
              const data = await res.json();
              if (data.reply) {
                chat.innerHTML += '<div class="msg bot"><b>ИИ-Бог:</b> ' + data.reply + (data.orderCreated ? '<br><b>[✅ ЗАКАЗ СОЗДАН В БАЗЕ!]</b>' : '') + '</div>';
              } else {
                chat.innerHTML += '<div class="msg bot" style="color:red">Ошибка: ' + (data.error || 'Ошибка вызова API') + '</div>';
              }
            } catch(e) {
              chat.innerHTML += '<div class="msg bot" style="color:red">Ошибка сети: ' + e.message + '</div>';
            }
            chat.scrollTop = chat.scrollHeight;
          }
        </script>
      </body>
      </html>
    `);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone = '+77071234567', message = '' } = req.body || {};

    if (!message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const supabase = getSupabase();
    const ai = getGemini();

    if (!supabase) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not set in .env' });
    if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });

    // Fetch conversation
    let { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let messages = conv ? (conv.messages || []) : [];

    // Fetch menu
    const { data: menuData } = await supabase.from('menu').select('name, price, category').eq('is_available', true);
    const menuFormatted = (menuData || []).map(item => `- ${item.name}: ${item.price}₸`).join('\n');

    const systemInstruction = `Ты — оператор доставки суши и пиццы "Nori / Sushi City" в ЖК «Асыл Арман». Твоя цель — отвечать КРАЙНЕ коротко, четко и по-человечески, ровно так, как реально переписываются администраторы в WhatsApp.

ПРИМЕРЫ НАСТОЯЩИХ ОТВЕТОВ ИЗ ЧАТА:
- Казахский привет / просьба меню: "Саламатсыз ба! Мәзірді жібердім [SEND_MENU_PDF]"
- Русский привет / просьба меню: "Здравствуйте! Вот наше меню [SEND_MENU_PDF]"
- Запрос адреса: "Адрес?" или "Қай адрес?"
- Выставление счета: "7390 тг. Оплата наличными или каспи Голдом +7(707)3767650 Айгерм А. Чек жібере аласыз ба?"
- Подтверждение: "Кабылданды" или "Принято! Ожидание 30-40 минут."

ПРАВИЛА ОБЩЕНИЯ:
1. БЕЗ ЭМОДЗИ: 0 смайликов. Вообще никаких эмодзи (кроме текстовой метки PDF).
2. ЯЗЫК: Строго на языке клиента (русский или казахский).
3. СТИЛЬ: 1-2 ультра-коротких предложения! Без лишних длинных речей.
4. ОТПРАВКА PDF МЕНЮ: Если клиент здоровается, просит меню или файл (например: "Салеметсизбе", "Меню жиберинизши", "Скиньте меню") — обязательно напиши приветствие и вставь метку [SEND_MENU_PDF].
5. ГОЛОСОВЫЕ СООБЩЕНИЯ: Клиент может прислать голосовое сообщение. Внимательно транскрибируй устную речь (на казахском или русском). Выдели позиции из меню, имя и адрес. В ответ включи текстовую расшифровку [VOICE_TEXT: "...расшифровка..."] и лаконичный ответ оператора.
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

    // Fast instant response for greetings & menu requests (0 API tokens consumed)
    const lowerMsg = (message || '').toLowerCase().trim();
    const isGreetingOrMenu = /^(салеметс|саламатс|здравст|привет|меню|мәзір)/i.test(lowerMsg);

    if (isGreetingOrMenu && messages.length <= 1) {
      const isKazakh = /(салемет|саламат|мәзір)/i.test(lowerMsg);
      const replyText = isKazakh 
        ? "Саламатсыз ба! Мәзірді жібердім" 
        : "Здравствуйте! Вот наше меню";
      
      const updatedMessages = [
        ...messages,
        { role: 'user', content: message },
        { role: 'assistant', content: replyText }
      ];

      if (conv) {
        await supabase.from('conversations').update({ messages: updatedMessages, updated_at: new Date().toISOString() }).eq('phone', phone);
      } else {
        await supabase.from('conversations').insert([{ phone: phone, messages: updatedMessages }]);
      }

      return res.status(200).json({
        status: 'success',
        reply: replyText,
        pdfSent: true,
        orderCreated: false,
        orderData: null
      });
    }

    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    contents.push({ role: 'user', parts: [{ text: message }] });

    let response;
    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

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
      }
    }

    let rawBotReply = response && response.text ? response.text : null;
    if (!rawBotReply) {
      const isKazakh = /(салемет|саламат|мәзір|рахмет|болды|тапсырыс)/i.test(lowerMsg);
      rawBotReply = isKazakh
        ? "Саламатсыз ба! Тапсырысыңыз бен мекенжайыңызды жазыңыз, қабылдаймын."
        : "Здравствуйте! Напишите ваш заказ и адрес доставки, принимаю!";
    }
    // Check for explicit trigger words for human operator
    const humanTrigger = /(человек|оператор|админ|менеджер|позови|свяжи|жалоба|ошибка в чеке|адам|операторды)/i.test(lowerMsg);
    if (humanTrigger) {
      const takeoverReply = lowerMsg.includes('адам') || lowerMsg.includes('операторды')
        ? "Секунд, операторға бағыттадым."
        : "Минутку, передаю диалог администратору.";

      const updatedMessages = [
        ...messages,
        { role: 'user', content: message },
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

      return res.status(200).json({
        status: 'success',
        reply: takeoverReply,
        requiresHuman: true,
        orderCreated: false,
        orderData: null
      });
    }

    let cleanBotReply = rawBotReply;
    let orderData = null;
    let receiptData = null;
    let requiresHumanData = null;

    // Robust JSON matching (supports ```json, ```JSON, or raw JSON object)
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
        console.log(`[Test-Chat] Order #${latestOrder.id} marked as PAID/READY via receipt test!`);
      }
    }

    let dbInsertSuccess = false;
    let dbErrorDetails = null;

    if (orderData) {
      const { data: insertedData, error: insertError } = await supabase
        .from('orders')
        .insert([{
          phone: phone,
          name: orderData.name || 'Тестовый Клиент',
          address: orderData.address || 'Адрес в ИИ диалоге',
          items: orderData.items || [],
          total: parseInt(orderData.total, 10) || 0,
          status: 'new'
        }])
        .select();

      if (insertError) {
        console.error('Supabase Order Insert Error:', insertError);
        dbErrorDetails = insertError.message;
      } else {
        console.log('Order successfully inserted into Supabase:', insertedData);
        dbInsertSuccess = true;
      }
    }

    const updatedMessages = [
      ...messages,
      { role: 'user', content: message },
      { role: 'assistant', content: cleanBotReply }
    ];

    if (conv) {
      await supabase.from('conversations').update({ messages: updatedMessages, updated_at: new Date().toISOString() }).eq('phone', phone);
    } else {
      await supabase.from('conversations').insert([{ phone: phone, messages: updatedMessages }]);
    }

    let pdfSent = false;
    if (cleanBotReply.includes('[SEND_MENU_PDF]')) {
      pdfSent = true;
      cleanBotReply = cleanBotReply.replace(/\[SEND_MENU_PDF\]/g, '').trim();
    }

    let voiceText = null;
    const voiceMatch = cleanBotReply.match(/\[VOICE_TEXT:\s*["']?([\s\S]*?)["']?\]/i);
    if (voiceMatch) {
      voiceText = voiceMatch[1].trim();
      cleanBotReply = cleanBotReply.replace(/\[VOICE_TEXT:\s*[\s\S]*?\]/gi, '').trim();
    }

    return res.status(200).json({
      status: 'success',
      reply: cleanBotReply,
      voiceText: voiceText,
      pdfSent: pdfSent,
      requiresHuman: !!requiresHumanData,
      receiptVerified: !!receiptData,
      orderCreated: !!orderData,
      orderData: orderData
    });

  } catch (err) {
    console.error('Error in test-chat:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
