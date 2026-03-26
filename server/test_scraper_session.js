const { loginAndFetchAttendance } = require('./scraper');

(async () => {
  // Test run 1 - should do full login, solve CAPTCHA, save session
  console.log("--- RUN 1 (Full Login) ---");
  let res = await loginAndFetchAttendance({ regNo: '12100000', password: 'password123' }).catch(e => console.error("RUN 1 ERR:", e.message));
  if (res && res.subjects) console.log(`Run 1 Success: ${res.subjects.length} subjects found.`);

  // Test run 2 - should skip CAPTCHA if valid session
  console.log("\n--- RUN 2 (Session Cookie Login) ---");
  let res2 = await loginAndFetchAttendance({ regNo: '12100000', password: 'password123' }).catch(e => console.error("RUN 2 ERR:", e.message));
  if (res2 && res2.subjects) console.log(`Run 2 Success: ${res2.subjects.length} subjects found.`);
})();
