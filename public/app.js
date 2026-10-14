const form = document.querySelector('#pairForm');
const phoneInput = document.querySelector('#phone');
const pairButton = document.querySelector('#pairButton');
const result = document.querySelector('#result');
const serviceStatus = document.querySelector('#serviceStatus');
const runtimeText = document.querySelector('#runtimeText');

function showResult({ title, message, code, error = false }) {
  result.classList.remove('hidden', 'error');
  if (error) result.classList.add('error');
  result.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = title;
  result.append(heading);
  if (code) {
    const codeElement = document.createElement('div');
    codeElement.className = 'pair-code';
    codeElement.textContent = code;
    result.append(codeElement);
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy';
    copyButton.textContent = 'Copy pairing code';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.replace(/-/g, ''));
        copyButton.textContent = 'Copied!';
      } catch {
        copyButton.textContent = 'Select and copy the code';
      }
    });
    result.append(copyButton);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  result.append(paragraph);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const phone = phoneInput.value.replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) {
    showResult({ title: 'Check your phone number', message: 'Include your country code, for example 2547XXXXXXXX for Kenya.', error: true });
    return;
  }
  pairButton.disabled = true;
  pairButton.querySelector('span:first-child').textContent = 'Preparing secure pairing…';
  result.classList.add('hidden');
  try {
    const response = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Pairing could not be started.');
    showResult({
      title: 'Your WhatsApp pairing code',
      code: data.code,
      message: 'On your phone, open WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead. Enter this code in WhatsApp.'
    });
  } catch (error) {
    showResult({ title: 'Pairing could not start', message: error.message || 'Please try again in a moment.', error: true });
  } finally {
    pairButton.disabled = false;
    pairButton.querySelector('span:first-child').textContent = 'Generate pairing code';
  }
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = '✓';
      setTimeout(() => { button.textContent = '⧉'; }, 1200);
    } catch {
      button.textContent = value;
    }
  });
});

async function refreshHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    serviceStatus.textContent = 'Service online';
    runtimeText.textContent = `${data.connected} connected session${data.connected === 1 ? '' : 's'} · ${data.sessions} saved in memory · uptime ${Math.floor(data.uptimeSeconds / 60)} min`;
  } catch {
    serviceStatus.textContent = 'Service unavailable';
    runtimeText.textContent = 'Could not reach the bot service';
  }
}

refreshHealth();
setInterval(refreshHealth, 30000);
