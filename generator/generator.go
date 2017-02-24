package generator

import (
	"bytes"
	"fmt"
	"github.com/tj/go-debug"
	"gopkg.in/yaml.v2"
	"io/ioutil"
	"regexp"
	"sort"
	"strings"
	"text/template"
	"time"
)

var dbg = debug.Debug("varnish-generator")

// Backend the varnish backend
type Backend struct {
	IP     string `yaml:",omitempty"`
	Port   int    `yaml:",omitempty"`
	Weight int    `yaml:",omitempty"`
}

// Director the varnish director
type Director struct {
	Name     string
	Prefix   string `yaml:",omitempty"`
	Host     string `yaml:",omitempty"`
	HashKey  string `yaml:"hashKey,omitempty"`
	Type     string
	Backends []Backend
}

// Config the varnish config
type Config struct {
	Name      string
	Stale     int    `yaml:",omitempty"`
	Version   string `yaml:",omitempty"`
	Varnish   string
	Directors []Director
}

// By the sort function of director
type By func(d1, d2 *Director) bool

// DirectorSorter the director sorter
type DirectorSorter struct {
	directors []Director
	by        func(d1, d2 *Director) bool
}

// Sort is a method on the function type, By, that sorts the argument slice according to the function
func (by By) Sort(directors []Director) {
	ps := &DirectorSorter{
		directors: directors,
		by:        by,
	}
	sort.Sort(ps)
}

// Len is part of sort.Interface
func (s *DirectorSorter) Len() int {
	return len(s.directors)
}

// Swap is part of sort.Interface
func (s *DirectorSorter) Swap(i, j int) {
	s.directors[i], s.directors[j] = s.directors[j], s.directors[i]
}

// Less is part of sort.Interface. It is implemented by calling the "by" closure in the sorter
func (s *DirectorSorter) Less(i, j int) bool {
	return s.by(&s.directors[i], &s.directors[j])
}

func checkError(err error) {
	if err != nil {
		panic(err)
	}
}

func toCamelCase(s string) string {
	byteSrc := []byte(s)
	rxCameling := regexp.MustCompile(`[\p{L}\p{N}]+`)
	chunks := rxCameling.FindAll(byteSrc, -1)
	for idx, val := range chunks {
		chunks[idx] = bytes.Title(val)
	}
	str := string(bytes.Join(chunks, nil))
	return strings.ToLower(str[:1]) + str[1:]
}

func getVarnishConfig(filename string) Config {
	buf, err := ioutil.ReadFile(filename)
	checkError(err)
	conf := Config{}
	err = yaml.Unmarshal(buf, &conf)
	checkError(err)
	getSortKey := func(d *Director) string {
		weight := 0
		if d.Host != "" {
			weight += 4
		}
		if d.Prefix != "" {
			weight += 2
		}
		return fmt.Sprintf("%d-%s", weight, d.Name)
	}
	sortDirector := func(d1, d2 *Director) bool {
		return getSortKey(d2) < getSortKey(d1)
	}
	By(sortDirector).Sort(conf.Directors)
	dbg("conf:%s", conf)
	return conf
}

func getBackendConfig(directors []Director) string {
	data, err := Asset("template/backend.tpl")
	checkError(err)
	tmpl, err := template.New("backend").Parse(string(data))
	checkError(err)
	type BackendConf struct {
		Name string
		IP   string
		Port int
	}
	arr := []string{}
	for _, director := range directors {
		for index, backend := range director.Backends {
			name := fmt.Sprintf("%s%d", toCamelCase(director.Name), index)
			data := BackendConf{name, backend.IP, backend.Port}
			var tpl bytes.Buffer
			err := tmpl.Execute(&tpl, data)
			checkError(err)
			arr = append(arr, tpl.String())
		}
	}
	return strings.Join(arr, "\n")
}

func getInitConfig(directors []Director) string {
	data, err := Asset("template/init.tpl")
	checkError(err)
	tmpl, err := template.New("init").Parse(string(data))
	checkError(err)
	arr := []string{}
	for _, director := range directors {
		name := toCamelCase(director.Name)
		t := "round_robin"
		if director.Type != "" {
			t = director.Type
		}
		arr = append(arr, fmt.Sprintf("  new %s = directors.%s();", name, t))
		for index, backend := range director.Backends {
			weight := 1
			if backend.Weight != 0 {
				weight = backend.Weight
			}
			if t == "random" || t == "hash" {
				arr = append(arr, fmt.Sprintf("  %s.add_backend(%s%d, %d);", name, name, index, weight))
			} else {
				arr = append(arr, fmt.Sprintf("  %s.add_backend(%s%d);", name, name, index))
			}
		}
	}
	type InitConfig struct {
		Directors string
	}
	var tpl bytes.Buffer
	err = tmpl.Execute(&tpl, InitConfig{strings.Join(arr, "\n")})
	checkError(err)
	return tpl.String()
}

func getBackendSelectConfig(directors []Director) string {
	type BackendHintConfig struct {
		Name      string
		Condition string
		Type      string
		HashKey   string
	}
	getBackendHint := func(hint *BackendHintConfig) string {
		name := toCamelCase(hint.Name)
		if hint.Type == "hash" {
			hashKey := "req.url"
			if hint.HashKey != "" {
				hashKey = hint.HashKey
			}
			return fmt.Sprintf("set req.backend_hint = %s.backend(%s);", name, hashKey)
		}
		return fmt.Sprintf("set req.backend_hint = %s.backend();", name)
	}
	var defaultBackendHint *BackendHintConfig
	result := []BackendHintConfig{}
	for _, director := range directors {
		arr := []string{}
		if director.Host != "" {
			arr = append(arr, fmt.Sprintf("req.http.host == \"%s\"", director.Host))
		}
		if director.Prefix != "" {
			arr = append(arr, fmt.Sprintf("req.url ~ \"^%s\"", director.Prefix))
		}
		condition := strings.Join(arr, " && ")
		if condition != "" {
			result = append(result, BackendHintConfig{director.Name, condition, director.Type, director.HashKey})
		} else {
			defaultBackendHint = &BackendHintConfig{director.Name, "", director.Type, director.HashKey}
		}
	}
	backendSelectorConfig := []string{}
	if defaultBackendHint != nil {
		backendSelectorConfig = append(backendSelectorConfig, getBackendHint(defaultBackendHint))
	}
	for index, item := range result {
		if index == 0 {
			backendSelectorConfig = append(backendSelectorConfig, fmt.Sprintf("if (%s) {", item.Condition))
		} else {
			backendSelectorConfig = append(backendSelectorConfig, fmt.Sprintf("} elsif (%s) {", item.Condition))
		}
		backendSelectorConfig = append(backendSelectorConfig, fmt.Sprintf("  %s", getBackendHint(&item)))
	}
	backendSelectorCount := len(backendSelectorConfig)
	formatConfs := []string{}
	if backendSelectorCount > 0 {
		if backendSelectorCount > 1 {
			backendSelectorConfig = append(backendSelectorConfig, "}")
		}
		for _, config := range backendSelectorConfig {
			formatConfs = append(formatConfs, fmt.Sprintf("  %s", config))
		}
	}
	return strings.Join(formatConfs, "\n")

}

// GetVcl get the varnish vcl
func GetVcl(filename string) string {
	conf := getVarnishConfig(filename)
	directors := conf.Directors
	backendConfig := getBackendConfig(directors)
	initConfig := getInitConfig(directors)
	backendSelectConfig := getBackendSelectConfig(directors)
	dbg("initConfig:%s", initConfig)
	dbg("backendSelectConfig:%s", backendSelectConfig)
	type VarnishConfig struct {
		Stale         int
		Name          string
		Varnish       string
		BackendConfig string
		InitConfig    string
		SelectConfig  string
		Version       string
	}

	dbg("conf:%s", conf)
	version := time.Now().UTC().Format(time.RFC3339)
	if conf.Version != "" {
		version = conf.Version
	}
	varnishConf := VarnishConfig{
		Stale:         conf.Stale,
		Name:          conf.Name,
		Varnish:       conf.Varnish,
		BackendConfig: backendConfig,
		InitConfig:    initConfig,
		SelectConfig:  backendSelectConfig,
		Version:       version,
	}
	data, err := Asset("template/varnish.tpl")
	checkError(err)
	tmpl, err := template.New("varnish").Parse(string(data))
	checkError(err)
	var tpl bytes.Buffer
	err = tmpl.Execute(&tpl, varnishConf)
	checkError(err)
	return tpl.String()
}
