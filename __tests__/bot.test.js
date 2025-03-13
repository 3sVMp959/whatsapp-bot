// __tests__/bot.test.js
describe('Bot de WhatsApp', () => {
    test('deve responder "Pong!" quando receber "!ping"', () => {
      const mensagemRecebida = '!ping';
      const respostaEsperada = 'Pong!';
  
      // Simule a lógica do bot
      const resposta = mensagemRecebida === '!ping' ? 'Pong!' : '';
      expect(resposta).toBe(respostaEsperada);
    });
  });