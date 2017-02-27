backend {{ .Name }} {
  .host = "{{ .IP }}";
  .port = "{{ .Port }}";
  .connect_timeout = {{ .Timeout.Connect }}s;
  .first_byte_timeout = {{ .Timeout.FirstByte }}s;
  .between_bytes_timeout = {{ .Timeout.BetweenBytes }}s;
  .probe = {
    .url = "/ping";
    .interval = 3s;
    .timeout = 5s;
    .window = 5;
    .threshold = 3;
  }
}
