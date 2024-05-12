import { google, gmail_v1, calendar_v3 } from "googleapis";
import ejs from "ejs";
import fs from "fs";

/**
 * Test the calendar access.
 *
 * @param {calendar_v3.Calendar} calendar
 * @return {void}
 */
export const testCalendarAccess = async (calendar) => {
  console.log("Access OK. Retrieving calendar events...");

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  });
  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log("No upcoming events found.");
    return;
  }
  console.log("Upcoming 10 events:");
  events.map((event, i) => {
    const start = event.start.dateTime || event.start.date;
    console.log(`${start} - ${event.summary}: ${event.id}`);
  });

  console.log("Access OK. Calendar events retrieved.");
};

/**
 * Get the event 7 days from now.
 *
 * @param {OAuth2Client} auth
 * @return {Promise<calendar_v3.Schema$Event>}
 */
export const getEvent7DaysFromNow = async (auth) => {
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const sevenDaysFromNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 2
  );

  const timeMin = new Date(
    sevenDaysFromNow.getFullYear(),
    sevenDaysFromNow.getMonth(),
    sevenDaysFromNow.getDate(),
    0,
    0,
    0
  ).toISOString();

  const timeMax = new Date(
    sevenDaysFromNow.getFullYear(),
    sevenDaysFromNow.getMonth(),
    sevenDaysFromNow.getDate(),
    23,
    59,
    59
  ).toISOString();

  console.log(`Getting events between ${timeMin} and ${timeMax}`);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin,
    timeMax: timeMax,
    timeZone: "Europe/Budapest",
    showDeleted: false,
    singleEvents: true,
  });

  const events = res.data.items;

  if (!events || events.length === 0) {
    console.error("No events found. Exiting...");
    return;
  } else if (events.length > 1) {
    console.error(
      `Error: ${events.length} events found, expected 1. Exiting...`
    );
    return;
  }

  return events[0];
};

/**
 * Get the event by ID.
 *
 * @param {calendar_v3.Calendar} calendar
 * @param {string} eventId
 * @return {Promise<calendar_v3.Schema$Event|undefined>}
 */
export const getEventById = async (calendar, eventId) => {
  try {
    const res = await calendar.events.get({
      calendarId: "primary",
      eventId,
    });

    return res.data;
  } catch (err) {
    console.error("Error fetching event", err);
    return undefined;
  }
};

/**
 * Run T-1.
 *
 * @param {any} config
 * @param {calendar_v3.Schema$Event} event
 * @param {gmail_v1.Gmail} gmail
 * @param {calendar_v3.Calendar} calendar
 * @param {boolean} [isReminder = false] isReminder
 * @return {void}
 */
export const processEvent = async (
  config,
  event,
  gmail,
  calendar,
  isReminder
) => {
  console.log(`Event found: ${event.summary}`);

  if (isReminder) {
    console.log("Sending reminder email...");

    // gmail returns time in utc instead of local time which is 2 hours behind so no decrement is needed :D
    const time = new Date(event.start.dateTime);

    await sendEmail(
      gmail,
      event,
      `${config.vilmaPath}/emails/reminder.ejs`,
      config.testTo, //acceptedAttendees.filter((attendee) => attendee.responseStatus === "needsAction" || attendee.responseStatus === "tentative").map((attendee) => attendee.email).join(",")
      isoDateToHour(time.toISOString())
    );

    return;
  }

  const acceptedAttendees = event.attendees.filter(
    (attendee) => attendee.responseStatus === "accepted"
  );

  console.log(`Number of accepted attendees: ${acceptedAttendees.length}`);

  if (acceptedAttendees.length < config.minimumNumberOfAttendees) {
    console.log("Not enough attendees. Sending cancel emails...");
    await sendEmail(
      gmail,
      event,
      `${config.vilmaPath}/emails/cancel.ejs`,
      config.organizersEmail,
      undefined,
      config.admin,
      undefined
    );
    console.log("Cancel email sent to BME.");

    await sendEmail(
      gmail,
      event,
      `${config.vilmaPath}/emails/cancel-players.ejs`,
      config.testTo,
      undefined,
      config.admin, //acceptedAttendees.map((attendee) => attendee.email).join(","),
      undefined
    );

    calendar.events.delete({
      calendarId: "primary",
      eventId: event.id,
      sendUpdates: "none",
    });

    console.log("Cancel emails sent.");
  } else {
    console.log("Enough players.");

    const acceptedAttendees = event.attendees
      .filter((attendee) => attendee.responseStatus === "accepted")
      .map((attendee) => attendee.email);

    console.log("Logging emails of players who accepted the invitation");
    saveAcceptedAttendees(
      `${config.vilmaPath}/player-logs`,
      acceptedAttendees,
      event
    );

    sendEmail(
      gmail,
      event,
      `${config.vilmaPath}/emails/player-report.ejs`,
      config.admin,
      undefined,
      undefined,
      acceptedAttendees
    );
    console.log("Emails logged.");

    console.log("Sending confirmation emails... ");
    await sendEmail(
      gmail,
      event,
      `${config.vilmaPath}/emails/confirm.ejs`,
      config.testTo,
      undefined,
      undefined, //acceptedAttendees.map((attendee) => attendee.email).join(",")
      undefined
    );
    console.log("Confirmation email sent to players.");
  }
};

/**
 * Send a cancel email.
 *
 * @param {gmail_v1.Gmail} gmail
 * @param {calendar_v3.Schema$Event} event
 * @param {string} templatePath
 * @param {string} to
 * @param {string|undefined} [vote_end = undefined] vote_end
 * @param {string|undefined} [bcc = undefined] bcc
 * @param {string[]|undefined} [players = undefined] players
 * @return {Promise<void>}
 */
const sendEmail = async (
  gmail,
  event,
  templatePath,
  to,
  vote_end,
  bcc,
  players
) => {
  const emailTemplate = fs.readFileSync(templatePath, {
    encoding: "utf-8",
  });

  const email = await ejs.render(emailTemplate, {
    send_to: to,
    date: event.start.dateTime.split("T")[0],
    from: isoDateToHour(event.start.dateTime),
    to: isoDateToHour(event.end.dateTime),
    day_of_week: new Date(event.start.dateTime).toLocaleDateString("hu-HU", {
      weekday: "long",
    }),
    players: players,
    send_bcc: bcc,
    vote_end: vote_end,
  });

  const base64Email = Buffer.from(email).toString("base64");

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: base64Email,
      },
    });
    console.log("Email sent.");
  } catch (err) {
    console.error("Error sending email: ", err);
  }
};

/**
 * Save the accepted attendees.
 *
 * @param {string[]} acceptedAttendees
 * @param {calendar_v3.Schema$Event} event
 * @return {void}
 */
const saveAcceptedAttendees = (path, acceptedAttendees, event) => {
  fs.writeFileSync(
    `${path}/${event.start.dateTime}.txt`,
    acceptedAttendees.join("\n"),
    { encoding: "utf-8" }
  );
};

/**
 * Convert a date time to hour.
 * @param {string} dateTime
 * @return {string}
 */
const isoDateToHour = (dateTime) => {
  return dateTime.split("T")[1].split("-")[0].split(":").slice(0, 2).join(":");
};
