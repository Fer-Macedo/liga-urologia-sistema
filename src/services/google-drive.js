// ─── SERVIÇO GOOGLE DRIVE ────────────────────────────────────────────────────
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file'
];

// Gera URL de autenticação
function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

// Troca code por tokens
async function getTokens(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Configura cliente com tokens
function getClient(tokens) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return client;
}

// Faz upload de arquivo para o Drive
async function uploadParaDrive(tokens, buffer, nome, mimetype) {
  const client = getClient(tokens);
  const drive = google.drive({ version: 'v3', auth: client });

  // Converte mimetype para Google Docs se necessario
  const mimeMap = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
    'application/msword': 'application/vnd.google-apps.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
    'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
    'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
  };

  const googleMime = mimeMap[mimetype];

  const { Readable } = require('stream');
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: googleMime || mimetype,
    },
    media: {
      mimeType: mimetype,
      body: stream,
    },
    fields: 'id, name, webViewLink, embedLink, mimeType',
    ...(googleMime ? { supportsAllDrives: true } : {})
  });

  // Torna publico para visualizacao
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' }
  });

  // Gera embed URL
  const fileId = res.data.id;
  const googleMimeType = res.data.mimeType;
  let embedUrl = '';
  if (googleMimeType === 'application/vnd.google-apps.document') {
    embedUrl = `https://docs.google.com/document/d/${fileId}/edit?embedded=true`;
  } else if (googleMimeType === 'application/vnd.google-apps.spreadsheet') {
    embedUrl = `https://docs.google.com/spreadsheets/d/${fileId}/edit?embedded=true`;
  } else if (googleMimeType === 'application/vnd.google-apps.presentation') {
    embedUrl = `https://docs.google.com/presentation/d/${fileId}/edit?embedded=true`;
  } else {
    embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  }

  return {
    fileId,
    nome: res.data.name,
    webViewLink: res.data.webViewLink,
    embedUrl,
    mimeType: googleMimeType || mimetype
  };
}

module.exports = { getAuthUrl, getTokens, getClient, uploadParaDrive };
