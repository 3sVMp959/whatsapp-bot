const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();

// Configuração do WhatsApp com autenticação persistente
const client = new Client({
    authStrategy: new LocalAuth(), // Salva sessão localmente
    puppeteer: { headless: true, args: ['--no-sandbox'] } // Necessário no Heroku
});

// Evento para exibir QR code (log para debug, ajuste conforme necessário)
client.on('qr', (qr) => {
    console.log('QR Code gerado:', qr);
    // Para o primeiro uso, envie o QR para outro lugar (ex.: API, e-mail)
});

// Evento quando o cliente está pronto
client.on('ready', () => {
    console.log('WhatsApp Client está pronto!');
});

// Evento para mensagens recebidas
client.on('message', msg => {
    if (msg.body === '!ping') {
        msg.reply('Pong!');
    }
});

// Inicializa o cliente WhatsApp
client.initialize();

// Configuração do servidor web para Heroku
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.send('Bot WhatsApp rodando!');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});