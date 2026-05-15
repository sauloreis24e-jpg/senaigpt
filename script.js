// =============================================
// SENAI-GPT — script.js
// Tudo em HTML + JS puro, sem Node.js.
// Chama a API da OpenAI / Azure direto do browser.
// =============================================

// ── Configuração da API (Azure OpenAI) ──────
const CHAT_ENDPOINT = "https://georg-ml7854jc-swedencentral.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview";
const CHAT_MODEL    = "gpt-5.2-chat";

// TTS — Azure Speech
const TTS_ENDPOINT        = "https://swedencentral.tts.speech.microsoft.com/cognitiveservices/v1";
const TTS_VOICE_MASCULINO = "pt-BR-AntonioNeural";
const TTS_VOICE_FEMININO  = "pt-BR-ThalitaNeural";  // versão compatível

// ── Estado global ────────────────────────────
let apiKey       = "";        // preenchida no login
let historico    = [];        // mensagens da conversa atual
let conversas    = [];        // lista de conversas salvas
let conversaId   = null;      // id da conversa atual
let imagemBase64 = null;      // imagem anexada (base64)
let vozAtual     = TTS_VOICE_MASCULINO;

// Microfone (STT simples)
let recognition  = null;
let gravando     = false;

// Modo voz completo (STT → Chat → TTS)
let modoVoz        = false;
let recVoz         = null;
let gravandoVoz    = false;

// ── Utilitários ──────────────────────────────
function $(id) { return document.getElementById(id); }

function saudacao() {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
}

// ── Login ─────────────────────────────────────
function validarEmail(input) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value);
    $("emailOk").style.display = ok ? "inline" : "none";
}

function toggleSenha() {
    const campo = $("loginSenha");
    campo.type = campo.type === "password" ? "text" : "password";
}

let fotoPerfilDataUrl = null;
function previewFotoPerfil(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        fotoPerfilDataUrl = e.target.result;
        // mostra preview no avatar do modal
        const avatar = $("loginAvatar");
        avatar.innerHTML = `<img src="${fotoPerfilDataUrl}" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:3px solid var(--accent);">`;
    };
    reader.readAsDataURL(file);
}

function fazerLogin() {
    const nome  = $("loginNome").value.trim()  || "Usuário";
    const email = $("loginEmail").value.trim()  || "user@senai.br";
    const senha = $("loginSenha").value;

    // A chave API pode ser digitada no campo de senha ou fica vazia (API pública não precisa)
    // Aqui usamos o campo "senha" como chave API para não precisar de um servidor.
    // Se o campo estiver vazio, tentamos sem Authorization header.
    apiKey = senha;

    $("loginModal").classList.add("hidden");
    $("app").classList.remove("hidden");

    // Preenche dados do usuário
    $("userNome").textContent = nome;
    const letra = nome.charAt(0).toUpperCase();
    $("userAvatarLetter").textContent = letra;

    if (fotoPerfilDataUrl) {
        $("userAvatarImg").src = fotoPerfilDataUrl;
        $("userAvatarImg").style.display = "block";
        $("userAvatarLetter").style.display = "none";
    }

    $("welcomeGreeting").textContent = `${saudacao()}, ${nome} 👋`;
    novaConversa();
}

function fazerLogout() {
    $("app").classList.add("hidden");
    $("loginModal").classList.remove("hidden");
    apiKey = "";
    historico = [];
    conversas = [];
    conversaId = null;
}

// ── Conversa ──────────────────────────────────
function novaConversa() {
    historico = [];
    imagemBase64 = null;

    conversaId = Date.now();
    conversas.unshift({ id: conversaId, titulo: "Nova conversa", msgs: [] });
    renderHistorico();

    $("chatBox").classList.add("hidden");
    $("chatBox").innerHTML = "";
    $("welcomeScreen").classList.remove("hidden");
    $("input").value = "";
    $("imagePreview").classList.add("hidden");
    autoResize($("input"));
}

function renderHistorico() {
    const lista = $("historicoLista");
    lista.innerHTML = "";
    conversas.forEach(c => {
        const item = document.createElement("div");
        item.className = "historico-item" + (c.id === conversaId ? " active" : "");
        item.textContent = c.titulo;
        item.onclick = () => carregarConversa(c.id);
        lista.appendChild(item);
    });
}

function carregarConversa(id) {
    const c = conversas.find(x => x.id === id);
    if (!c) return;
    conversaId = id;
    historico  = [...c.msgs];

    $("chatBox").innerHTML = "";
    $("chatBox").classList.remove("hidden");
    $("welcomeScreen").classList.add("hidden");

    historico.forEach(msg => {
        if (msg.role === "user") {
            const texto = typeof msg.content === "string"
                ? msg.content
                : (msg.content.find(x => x.type === "text")?.text || "");
            adicionarMensagem("user", texto);
        } else if (msg.role === "assistant") {
            adicionarMensagem("bot", msg.content);
        }
    });

    renderHistorico();
    scrollChat();
}

// ── Envio de mensagem ──────────────────────────
function sugerir(texto) {
    $("input").value = texto;
    enviarMensagem();
}

async function enviarMensagem() {
    const texto = $("input").value.trim();
    if (!texto && !imagemBase64) return;

    $("welcomeScreen").classList.add("hidden");
    $("chatBox").classList.remove("hidden");

    // Monta conteúdo do usuário
    let userContent;
    if (imagemBase64) {
        const mediaType = imagemBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
        const base64Data = imagemBase64.split(",")[1];
        userContent = [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Data}` } },
            { type: "text", text: texto || "Descreva esta imagem." }
        ];
    } else {
        userContent = texto;
    }

    adicionarMensagem("user", typeof userContent === "string" ? userContent : (texto || "[Imagem]"));
    $("input").value = "";
    autoResize($("input"));
    removerImagem();

    // Atualiza histórico e título da conversa
    historico.push({ role: "user", content: userContent });
    const conv = conversas.find(c => c.id === conversaId);
    if (conv && conv.titulo === "Nova conversa" && texto) {
        conv.titulo = texto.slice(0, 40);
        renderHistorico();
    }

    // Indicador de digitação
    const typingId = "typing-" + Date.now();
    adicionarTyping(typingId);
    scrollChat();

    try {
        const resposta = await chamarChat(historico);
        removerTyping(typingId);
        historico.push({ role: "assistant", content: resposta });
        if (conv) conv.msgs = [...historico];
        adicionarMensagem("bot", resposta);
        scrollChat();
    } catch (err) {
        removerTyping(typingId);
        adicionarMensagem("bot", "⚠️ Erro ao conectar com a API. Verifique sua chave/endpoint. " + err.message);
        scrollChat();
    }
}

// ── Chamada à API OpenAI / Azure ──────────────
async function chamarChat(msgs, maxTokens = 1000) {
    const sistemaMensagem = {
        role: "system",
        content: "Você é uma IA amigável chamada SENAI-GPT. Responda sempre em português brasileiro."
    };

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const resp = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [sistemaMensagem, ...msgs],
            max_completion_tokens: maxTokens
        })
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "Sem resposta.";
}

// ── TTS ────────────────────────────────────────
async function chamarTTS(texto, voz) {
    const ssml = `<speak version='1.0' xml:lang='pt-BR'><voice name='${voz}'>${escapeXML(texto)}</voice></speak>`;

    const headers = {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3"
    };
    if (apiKey) headers["Ocp-Apim-Subscription-Key"] = apiKey;

    const resp = await fetch(TTS_ENDPOINT, { method: "POST", headers, body: ssml });
    if (!resp.ok) throw new Error(`TTS ${resp.status}`);

    const buf  = await resp.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
}

function escapeXML(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

async function ouvirMensagem(btn, texto, voz) {
    btn.disabled = true;
    btn.textContent = "⏳";
    try {
        const url   = await chamarTTS(texto, voz);
        const audio = new Audio(url);
        audio.play();
        btn.textContent = "🔊";
        audio.onended = () => { btn.disabled = false; btn.textContent = "🔊"; };
    } catch {
        btn.textContent = "🔊";
        btn.disabled = false;
    }
}

// ── Renderização de mensagens ─────────────────
function adicionarMensagem(role, texto) {
    const chatBox = $("chatBox");
    const grupo   = document.createElement("div");
    grupo.className = `msg-group ${role}`;

    if (role === "user") {
        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.textContent = texto;
        grupo.appendChild(bubble);
    } else {
        // cabeçalho bot
        const header = document.createElement("div");
        header.className = "bot-header";
        header.innerHTML = `<div class="bot-avatar">⚡</div><span class="bot-name">SENAI-GPT</span>`;

        // controles de voz
        const vozControles = document.createElement("div");
        vozControles.className = "voz-controles";

        const seletor = document.createElement("select");
        seletor.className = "voz-mini-select";
        seletor.innerHTML = `<option value="${TTS_VOICE_MASCULINO}">🧑 Antônio</option><option value="${TTS_VOICE_FEMININO}">👩 Thalita</option>`;

        const btnOuvir = document.createElement("button");
        btnOuvir.className = "btn-ouvir";
        btnOuvir.textContent = "🔊";
        btnOuvir.onclick = () => ouvirMensagem(btnOuvir, texto, seletor.value);

        vozControles.appendChild(seletor);
        vozControles.appendChild(btnOuvir);
        header.appendChild(vozControles);

        const bubble = document.createElement("div");
        bubble.className = "msg-bubble";
        bubble.innerHTML = formatarMarkdown(texto);

        grupo.appendChild(header);
        grupo.appendChild(bubble);
    }

    chatBox.appendChild(grupo);
}

function formatarMarkdown(texto) {
    return texto
        .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
            `<pre style="background:var(--bg3);border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0;font-size:13px;"><code>${escapeHTML(code.trim())}</code></pre>`)
        .replace(/`([^`]+)`/g, `<code style="background:var(--bg3);padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>`)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g,    "<em>$1</em>")
        .replace(/^### (.+)$/gm,  "<h3 style='margin:12px 0 4px;font-size:15px;'>$1</h3>")
        .replace(/^## (.+)$/gm,   "<h2 style='margin:14px 0 4px;font-size:17px;'>$1</h2>")
        .replace(/^# (.+)$/gm,    "<h1 style='margin:16px 0 6px;font-size:19px;'>$1</h1>")
        .replace(/^- (.+)$/gm,    "<li style='margin:2px 0;'>$1</li>")
        .replace(/(<li.*<\/li>\n?)+/g, m => `<ul style='padding-left:20px;margin:6px 0;'>${m}</ul>`)
        .replace(/\n/g, "<br>");
}

function escapeHTML(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function adicionarTyping(id) {
    const chatBox = $("chatBox");
    const grupo   = document.createElement("div");
    grupo.className = "msg-group bot";
    grupo.id = id;
    grupo.innerHTML = `
        <div class="bot-header">
          <div class="bot-avatar">⚡</div>
          <span class="bot-name">SENAI-GPT</span>
        </div>
        <div class="typing-dots"><span></span><span></span><span></span></div>`;
    chatBox.appendChild(grupo);
}

function removerTyping(id) {
    const el = $(id);
    if (el) el.remove();
}

function scrollChat() {
    const chatBox = $("chatBox");
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ── Imagem ────────────────────────────────────
function selecionarImagem(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        imagemBase64 = e.target.result;
        $("previewImg").src = imagemBase64;
        $("imagePreview").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
}

function removerImagem() {
    imagemBase64 = null;
    $("imagePreview").classList.add("hidden");
    $("fileInput").value = "";
}

// ── Resize textarea ───────────────────────────
function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ── Enter para enviar ─────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    $("input").addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            enviarMensagem();
        }
    });
});

// ── Sidebar ───────────────────────────────────
function toggleSidebar() {
    $("sidebar").classList.toggle("collapsed");
}

// ── Microfone (STT simples — transcreve no campo) ──
function toggleMicrofone() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Seu navegador não suporta reconhecimento de voz.");
        return;
    }

    if (gravando) {
        recognition.stop();
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        gravando = true;
        $("btnMic").classList.add("gravando");
    };
    recognition.onend  = () => {
        gravando = false;
        $("btnMic").classList.remove("gravando");
    };
    recognition.onerror = () => {
        gravando = false;
        $("btnMic").classList.remove("gravando");
    };
    recognition.onresult = e => {
        const transcricao = e.results[0][0].transcript;
        $("input").value += transcricao;
        autoResize($("input"));
    };

    recognition.start();
}

// ── Modo voz completo (STT → Chat → TTS) ──────
function toggleModoVoz() {
    if (modoVoz) {
        pararModoVoz();
    } else {
        iniciarModoVoz();
    }
}

function iniciarModoVoz() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Seu navegador não suporta reconhecimento de voz.");
        return;
    }

    modoVoz = true;
    $("btnVozChat").classList.add("gravando");
    mostrarStatusVoz("🎤 Ouvindo...");

    recVoz = new SpeechRecognition();
    recVoz.lang = "pt-BR";
    recVoz.continuous = false;
    recVoz.interimResults = false;

    recVoz.onresult = async e => {
        const transcricao = e.results[0][0].transcript;
        mostrarStatusVoz("⌛ Processando...");
        gravandoVoz = false;
        $("btnVozChat").classList.remove("gravando");

        // Mostra no chat como mensagem do usuário
        $("welcomeScreen").classList.add("hidden");
        $("chatBox").classList.remove("hidden");
        adicionarMensagem("user", transcricao);
        historico.push({ role: "user", content: transcricao });

        const conv = conversas.find(c => c.id === conversaId);
        if (conv && conv.titulo === "Nova conversa") {
            conv.titulo = transcricao.slice(0, 40);
            renderHistorico();
        }

        const typingId = "typing-voz-" + Date.now();
        adicionarTyping(typingId);
        scrollChat();

        try {
            const resposta = await chamarChat(historico, 500);
            removerTyping(typingId);
            historico.push({ role: "assistant", content: resposta });
            if (conv) conv.msgs = [...historico];
            adicionarMensagem("bot", resposta);
            scrollChat();

            // TTS
            mostrarStatusVoz("🔊 Falando...");
            try {
                const audioUrl = await chamarTTS(resposta, vozAtual);
                const audio = new Audio(audioUrl);
                audio.play();
                audio.onended = () => {
                    esconderStatusVoz();
                    modoVoz = false;
                };
            } catch {
                esconderStatusVoz();
                modoVoz = false;
            }
        } catch (err) {
            removerTyping(typingId);
            adicionarMensagem("bot", "⚠️ Erro: " + err.message);
            scrollChat();
            esconderStatusVoz();
            modoVoz = false;
        }
    };

    recVoz.onerror = () => {
        gravandoVoz = false;
        $("btnVozChat").classList.remove("gravando");
        esconderStatusVoz();
        modoVoz = false;
    };

    recVoz.onend = () => {
        gravandoVoz = false;
        $("btnVozChat").classList.remove("gravando");
    };

    gravandoVoz = true;
    recVoz.start();
}

function pararModoVoz() {
    modoVoz = false;
    gravandoVoz = false;
    $("btnVozChat").classList.remove("gravando");
    esconderStatusVoz();
    if (recVoz) { try { recVoz.stop(); } catch {} }
}

function mostrarStatusVoz(msg) {
    let el = $("statusVoz");
    if (!el) {
        el = document.createElement("div");
        el.id = "statusVoz";
        el.className = "status-voz";
        $("chatBox").parentNode.insertBefore(el, $("chatBox").nextSibling);
    }
    el.textContent = msg;
    el.style.display = "block";
}

function esconderStatusVoz() {
    const el = $("statusVoz");
    if (el) el.style.display = "none";
}
