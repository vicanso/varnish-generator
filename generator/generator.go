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
	HashKey  string `yaml:",omitempty"`
	Type     string
	Backends []Backend
}

// Config the varnish config
type Config struct {
	Name      string
	Stale     int `yaml:",omitempty"`
	Varnish   int
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
	return string(bytes.Join(chunks, nil))
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
	for _, director := range directors {
		name := toCamelCase(director.Name)
		t := ""
		if director.Type != "" {
			t = "round_robin"
		} else {
			t = director.Type
		}
		dbg("type:%s", t)
		// for index, backend := range director.Backends {
		// 	debug("name")
		// }

	}
	return ""
}

// GetVcl get the varnish vcl
func GetVcl(filename string) string {
	conf := getVarnishConfig(filename)
	directors := conf.Directors
	backendConfig := getBackendConfig(directors)
	getInitConfig(directors)
	return backendConfig
}
