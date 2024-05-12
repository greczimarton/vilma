import { authenticate } from "@google-cloud/local-auth";
import fs from "fs";
import { google } from "googleapis";

/**
 * Reads previously authorized credentials from the save file.
 *
 * @param {string} tokenPath
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist(tokenPath) {
  try {
    const content = fs.readFileSync(tokenPath, { encoding: "utf-8" });
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @param {string} credentialsPath
 * @param {string} tokenPath
 * @return {Promise<void>}
 */
async function saveCredentials(client, credentialsPath, tokenPath) {
  const content = fs.readFileSync(credentialsPath);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  fs.writeFileSync(tokenPath, payload, { encoding: "utf-8" });
}

/**
 * Load or request or authorization to call APIs.
 *
 * @param {string[]} scopes
 * @param {string} credentialsPath
 * @param {string} tokenPath
 */
async function authorize(scopes, credentialsPath, tokenPath) {
  const client = await authenticate({
    scopes: scopes,
    keyfilePath: credentialsPath,
  });
  if (client.credentials) {
    await saveCredentials(client, credentialsPath, tokenPath);
  }
}

export const runAuth = async (config) => {
  const loadedCredentials = await loadSavedCredentialsIfExist(
    `${config.vilmaPath}/auth/token.json`
  );

  if (loadedCredentials) {
    console.log(`Credentials already exist. No need to run this again. 
You can test the credentials by running 'vilma test'`);
    return;
  }

  console.log("Credentials not found. Authenticating...");

  await authorize(
    config.scopes,
    `${config.vilmaPath}/auth/credentials.json`,
    `${config.vilmaPath}/auth/token.json`
  );

  console.log("Credentials saved.");
};

/**
 * Get the OAuth2Client instance.
 *
 * @param {string} tokenPath
 * @return {Promise<OAuth2Client>}
 */
export const getAuth = async (tokenPath) => {
  const auth = await loadSavedCredentialsIfExist(tokenPath);

  if (!auth) {
    console.log(`No credentials found. Please run 'vilma auth' first.`);
    return;
  }

  return auth;
};
