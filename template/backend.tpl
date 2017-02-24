backend <%= name %> {
  .host = "<%= ip %>";
  .port = "<%= port %>";
  .connect_timeout = <%= timeout.connect %>s;
  .first_byte_timeout = <%= timeout.firstByte %>s;
  .between_bytes_timeout = <%= timeout.betweenBytes %>s;
  .probe = {
    .url = "/ping";
    .interval = 3s;
    .timeout = 5s;
    .window = 5;
    .threshold = 3;
  }
}
