backend {{ .Name }} {
  .host = "{{ .IP }}";
  .port = "{{ .Port }}";
  .connect_timeout = 2s;
  .first_byte_timeout = 5s;
  .between_bytes_timeout = 2s;
  .probe = {
    .url = "/ping";
    .interval = 3s;
    .timeout = 5s;
    .window = 5;
    .threshold = 3;
  }
}
