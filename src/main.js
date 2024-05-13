#!/usr/bin/env node

import { runAuth, getAuth } from "./lib/auth.js";
import {
  testCalendarAccess,
  getEvent7DaysFromNow,
  processEvent,
  getEventById,
} from "./lib/google.js";
import { google } from "googleapis";
import path from "path";
import os from "os";
import fs from "fs";

/**
 * @readonly
 * @enum {string}
 */
const Commands = {
  Auth: "auth",
  TestT1: "test1",
  TestT2: "test2",
  Event: "event",
  T1: "t-1",
  T2: "t-2",
  T8: "t-8",
};

const printHelp = () => {
  console.log(
    `Please provide a command.

Usage: vilma [${Object.values(Commands).join(" or ")}]

auth: Get credential tokens (you need to run this first and only once)
test: Test the credentials
t-1: Run t-1 task
t-2: Run t-2 task
t-8: Run t-8 task
    `
  );
};

const getTokenPath = (config) => {
  return path.resolve(config.vilmaPath, "auth/token.json");
};

const runTest = async (config) => {
  const tokenPath = getTokenPath(config);
  const auth = await getAuth(tokenPath);

  if (!auth) {
    return;
  }

  const calendar = google.calendar({ version: "v3", auth });

  await testCalendarAccess(calendar);
};

const runEvent = async (args, config, isReminder) => {
  if (args.length < 4) {
    console.error("Please provide an event ID. vilma event <event-id>");
    return;
  }

  const eventId = args[3];

  const tokenPath = getTokenPath(config);
  const auth = await getAuth(tokenPath);

  if (!auth) {
    return;
  }

  console.log(`Getting event by ID: '${eventId}'`);

  const calendar = google.calendar({ version: "v3", auth });
  const event = await getEventById(calendar, eventId);

  if (!event) {
    return;
  }

  const gmail = google.gmail({ version: "v1", auth });

  await processEvent(config, event, gmail, calendar, isReminder);
};

const runT1 = async (config) => {
  const tokenPath = getTokenPath(config);
  const auth = await getAuth(tokenPath);

  if (!auth) {
    return;
  }

  const event = await getEvent7DaysFromNow(auth);

  if (!event) {
    return;
  }

  const gmail = google.gmail({ version: "v1", auth });
  const calendar = google.calendar({ version: "v3", auth });

  await processEvent(config, event, gmail, calendar);
};

/**
 * Run T-2 or T-8.
 *
 * @param {any} config
 * @param {string} reminderType
 * @return {Promise<void>}
 */
const runT2 = async (config) => {
  const tokenPath = getTokenPath(config);
  const auth = await getAuth(tokenPath);

  if (!auth) {
    return;
  }

  const event = await getEvent7DaysFromNow(auth);

  if (!event) {
    return;
  }

  const gmail = google.gmail({ version: "v1", auth });
  const calendar = google.calendar({ version: "v3", auth });

  await processEvent(config, event, gmail, calendar, true);
};

const main = async (args) => {
  if (args.length < 3) {
    printHelp();
    return;
  }

  let config = undefined;

  try {
    const configPath = path.join(os.homedir(), ".config/vilma/config.json");
    // const configPath =
    //   "/Users/greczimarton/personal/vilma-vball-2024/vilma/config.json";
    config = JSON.parse(
      fs.readFileSync(configPath, {
        encoding: "utf-8",
      })
    );
  } catch (e) {
    console.error(
      `Config file not found. Please create one in ~/.config/vilma/config.json. Exiting... ${e}`
    );
    return;
  }

  switch (args[2]) {
    case Commands.Auth:
      await runAuth(config);
      break;
    case Commands.Test:
      await runTest(config);
      break;
    case Commands.Event:
      await runEvent(args, config);
      break;
    case Commands.T1:
      await runT1(config);
      break;
    case Commands.TestT1:
      await runEvent(args, config, false);
      break;
    case Commands.T2:
      await runT2(config);
      break;
    case Commands.TestT2:
      await runEvent(args, config, true);
      break;
  }
};

main(process.argv);
