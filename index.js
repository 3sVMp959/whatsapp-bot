const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');
const { exec } = require('child_process');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let processingQueue = [];
let isProcessing = false;

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('[LOG] Bot está pronto!'));
client.on('disconnected', reason => console.log('[LOG] Bot desconectado:', reason));
client.on('authenticated', () => console.log('[LOG] Cliente autenticado!'));
client.on('auth_failure', msg => console.error('[LOG] Falha na autenticação:', msg));

client.on('message', async message => {
    console.log(`[LOG] Mensagem recebida: "${message.body}", Tem mídia? ${message.hasMedia}`);
    
    if (message.body === '.ping') {
        await message.reply('Pong!');
    } else if ((message.body === '.fig' || message.body === '.fill') && (message.hasMedia || message.hasQuotedMsg)) {
        const taskId = uuidv4();
        console.log(`[LOG:${taskId}] Novo pedido recebido`);
        processingQueue.push({ message, taskId });
        processQueue();
    } else if ((message.body === '.fig' || message.body === '.fill') && !message.hasMedia) {
        await message.reply('Por favor, envie uma imagem, GIF ou vídeo junto com o comando ou marque uma mídia.');
    }
});

async function processQueue() {
    if (isProcessing || processingQueue.length === 0) return;
    isProcessing = true;

    const { message, taskId } = processingQueue.shift();
    const targetMessage = message.hasQuotedMsg ? await message.getQuotedMessage() : message;
    
    try {
        await processSticker(targetMessage, taskId);
    } catch (error) {
        console.error(`[LOG:${taskId}] Erro no processamento:`, error);
        await message.reply('Erro ao criar a figurinha. Tente novamente!');
    } finally {
        isProcessing = false;
        processQueue();
    }
}

async function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        const command = `${ffmpegPath} -i ${filePath} -hide_banner`;
        exec(command, (err, stdout, stderr) => {
            if (err) {
                const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1], 10);
                    const minutes = parseInt(durationMatch[2], 10);
                    const seconds = parseFloat(durationMatch[3]);
                    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
                    resolve(totalSeconds);
                } else {
                    reject(new Error('Não foi possível obter a duração do vídeo'));
                }
            } else {
                reject(new Error('Erro inesperado ao executar FFmpeg'));
            }
        });
    });
}

async function processVideoToFitSize(inputPath, outputPath, taskId, maxSizeBytes = 512000) {
    const duration = await getVideoDuration(inputPath);
    console.log(`[LOG:${taskId}] Duração do vídeo: ${duration} segundos`);
    if (duration > 7) {
        return { success: false, message: 'O vídeo deve ter menos de 7 segundos.' };
    }

    let targetDuration = Math.min(duration, 5);
    let quality = 30;
    let scale = '512:512:force_original_aspect_ratio=disable';
    let frameRate = 15;

    while (true) {
        const ffmpegCommand = `${ffmpegPath} -i ${inputPath} -t ${targetDuration} -vf "scale=${scale}" -loop 0 -an -c:v libwebp -q:v ${quality} -r ${frameRate} ${outputPath}`;
        console.log(`[LOG:${taskId}] Tentando FFmpeg: ${ffmpegCommand}`);

        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (err, stdout, stderr) => {
                if (err) {
                    console.error(`[LOG:${taskId}] Erro no FFmpeg:`, err, stderr);
                    reject(err);
                } else {
                    console.log(`[LOG:${taskId}] FFmpeg concluído`);
                    resolve();
                }
            });
        });

        const webpBuffer = fs.readFileSync(outputPath);
        console.log(`[LOG:${taskId}] Tamanho do WebP: ${webpBuffer.length} bytes`);

        if (webpBuffer.length <= maxSizeBytes) {
            return { success: true, buffer: webpBuffer };
        }

        if (quality > 10) {
            quality -= 10;
        } else if (scale.includes('512')) {
            scale = '256:256:force_original_aspect_ratio=disable';
        } else if (frameRate > 10) {
            frameRate -= 5;
        } else if (targetDuration > 1) {
            targetDuration -= 1;
        } else {
            return { success: false, message: 'Não foi possível ajustar o vídeo para ficar abaixo de 500 KB. Tente um vídeo menor.' };
        }

        fs.unlinkSync(outputPath);
    }
}

async function processSticker(message, taskId) {
    const inputPath = `input_${taskId}.mp4`;
    const outputPath = `output_${taskId}.webp`;

    try {
        console.log(`[LOG:${taskId}] Baixando mídia...`);
        const media = await message.downloadMedia();
        if (!media) {
            console.log(`[LOG:${taskId}] Falha ao baixar mídia`);
            throw new Error('Erro ao baixar a mídia.');
        }
        console.log(`[LOG:${taskId}] Mídia baixada: Tipo ${media.mimetype}, Tamanho ${media.data.length} bytes`);

        if (media.mimetype.includes('image') && !media.mimetype.includes('gif')) {
            console.log(`[LOG:${taskId}] Processando imagem estática...`);
            const buffer = await sharp(Buffer.from(media.data, 'base64'))
                .resize(512, 512, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 80 })
                .toBuffer();
            console.log(`[LOG:${taskId}] Imagem processada, Tamanho: ${buffer.length} bytes`);
            
            if (buffer.length > 100000) {
                console.log(`[LOG:${taskId}] Figurinha estática excede 100 KB`);
                throw new Error('Erro: A figurinha estática excede o limite de 100 KB.');
            }
            const stickerMedia = new MessageMedia('image/webp', buffer.toString('base64'));
            await client.sendMessage(message.from, stickerMedia, { sendMediaAsSticker: true });
            console.log(`[LOG:${taskId}] Figurinha estática enviada`);
        } else if (media.mimetype.includes('video') || media.mimetype.includes('gif')) {
            console.log(`[LOG:${taskId}] Processando figurinha animada...`);
            fs.writeFileSync(inputPath, Buffer.from(media.data, 'base64'));
            console.log(`[LOG:${taskId}] Arquivo de entrada salvo`);

            const result = await processVideoToFitSize(inputPath, outputPath, taskId);
            if (!result.success) {
                throw new Error(result.message);
            }

            const stickerMedia = new MessageMedia('image/webp', result.buffer.toString('base64'));
            await client.sendMessage(message.from, stickerMedia, { sendMediaAsSticker: true });
            console.log(`[LOG:${taskId}] Figurinha animada enviada`);
        } else {
            console.log(`[LOG:${taskId}] Formato não suportado: ${media.mimetype}`);
            throw new Error('Formato não suportado. Envie uma imagem, GIF ou vídeo.');
        }
    } finally {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

// Limpeza periódica de arquivos temporários
setInterval(() => {
    const tempFiles = fs.readdirSync('.').filter(f => f.startsWith('input_') || f.startsWith('output_'));
    tempFiles.forEach(file => {
        const stats = fs.statSync(file);
        if (Date.now() - stats.mtimeMs > 5 * 60 * 1000) {
            fs.unlinkSync(file);
            console.log(`[LOG] Arquivo temporário removido: ${file}`);
        }
    });
}, 10 * 60 * 1000);

client.initialize();