const { loginAndFetchAttendance } = require('./scraper');

(async () => {
  console.log("Starting test...");
  try {
    let res = await loginAndFetchAttendance({ regNo: '12100000', password: 'badpassword' });
    console.log("Success:", !!res);
    process.exit(0);
  } catch (err) {
    console.error("FATAL ERROR IN SCRAPER:");
    console.error(err);
    process.exit(1);
  }
})();
