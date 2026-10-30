// MiusMissionMaker: desktop editor for scenario files. It shows the page in web/ in a native
// window and leaves building and installing to tools/scenario.js and tools/install_mission.js.
//
//	go build -ldflags=-H=windowsgui -o ../MiusMissionMaker.exe .
//	MiusMissionMaker.exe -serve 127.0.0.1:8765      (no window, for use in a browser)
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed web
var webFiles embed.FS

const defaultGameDir = `C:\Program Files (x86)\Steam\steamapps\common\Graviteam Tactics Mius-Front`

var idPattern = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)

type app struct {
	root     string // project folder containing tools/scenario.js
	settings string // settings file
}

type settings struct {
	GameDir string `json:"gameDir"`
}

// findRoot looks for the project folder next to the executable and upwards from it.
func findRoot() (string, error) {
	starts := []string{}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, dir := range starts {
		for {
			if _, err := os.Stat(filepath.Join(dir, "tools", "scenario.js")); err == nil {
				return dir, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", errors.New("tools/scenario.js not found - keep the program in the MiusMissionMaker folder")
}

func (a *app) loadSettings() settings {
	s := settings{GameDir: defaultGameDir}
	if b, err := os.ReadFile(a.settings); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func (a *app) saveSettings(s settings) error {
	if err := os.MkdirAll(filepath.Dir(a.settings), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(a.settings, b, 0o644)
}

// node runs a project tool and returns its combined output.
func (a *app) node(args ...string) (string, error) {
	path, err := exec.LookPath("node")
	if err != nil {
		return "", errors.New("Node.js not found in PATH")
	}
	cmd := exec.Command(path, args...)
	cmd.Dir = a.root
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

type scenarioFile struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Group string `json:"group"`
}

func (a *app) listScenarios() []scenarioFile {
	list := []scenarioFile{}
	for _, group := range []string{"scenarios", "examples"} {
		files, _ := filepath.Glob(filepath.Join(a.root, group, "*.json"))
		sort.Strings(files)
		for _, f := range files {
			name := strings.TrimSuffix(filepath.Base(f), ".json")
			list = append(list, scenarioFile{Path: group + "/" + name + ".json", Name: name, Group: group})
		}
	}
	return list
}

// scenarioPath only accepts files directly inside scenarios/ or examples/.
func (a *app) scenarioPath(rel string) (string, error) {
	group, name, ok := strings.Cut(rel, "/")
	if !ok || (group != "scenarios" && group != "examples") || name != filepath.Base(name) || !strings.HasSuffix(name, ".json") {
		return "", fmt.Errorf("invalid scenario path %q", rel)
	}
	return filepath.Join(a.root, group, name), nil
}

// store writes a scenario to scenarios/<id>.json, keeping the field order of the page.
func (a *app) store(raw json.RawMessage) (string, error) {
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return "", err
	}
	if !idPattern.MatchString(head.ID) {
		return "", errors.New(`mission id: use a-z, 0-9 and _ only (max. 40 characters)`)
	}
	dir := filepath.Join(a.root, "scenarios")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	file := filepath.Join(dir, head.ID+".json")
	return file, os.WriteFile(file, append(raw, '\n'), 0o644)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func (a *app) routes(prefix string) http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(webFiles, "web")
	mux.Handle("/", http.FileServer(http.FS(static)))

	mux.HandleFunc(prefix+"/catalog", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(a.root, "docs", "catalog.json"))
	})
	mux.HandleFunc(prefix+"/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var s settings
			if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
				fail(w, err)
				return
			}
			if err := a.saveSettings(s); err != nil {
				fail(w, err)
				return
			}
		}
		writeJSON(w, a.loadSettings())
	})
	mux.HandleFunc(prefix+"/scenarios", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.listScenarios())
	})
	mux.HandleFunc(prefix+"/scenario", func(w http.ResponseWriter, r *http.Request) {
		file, err := a.scenarioPath(r.URL.Query().Get("path"))
		if err != nil {
			fail(w, err)
			return
		}
		http.ServeFile(w, r, file)
	})
	mux.HandleFunc(prefix+"/save", func(w http.ResponseWriter, r *http.Request) {
		var raw json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			fail(w, err)
			return
		}
		file, err := a.store(raw)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, map[string]string{"file": file})
	})
	mux.HandleFunc(prefix+"/build", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Scenario json.RawMessage `json:"scenario"`
			Install  bool            `json:"install"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			fail(w, err)
			return
		}
		file, err := a.store(req.Scenario)
		if err != nil {
			fail(w, err)
			return
		}
		args := []string{"tools/scenario.js", "build", file, "--game", a.loadSettings().GameDir}
		if req.Install {
			args = append(args, "--install")
		}
		out, err := a.node(args...)
		writeJSON(w, map[string]any{"ok": err == nil, "output": out})
	})
	mux.HandleFunc(prefix+"/mods", func(w http.ResponseWriter, r *http.Request) {
		out, err := a.node("tools/install_mission.js", "list", a.loadSettings().GameDir)
		writeJSON(w, map[string]any{"ok": err == nil, "output": out})
	})
	mux.HandleFunc(prefix+"/uninstall", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			fail(w, err)
			return
		}
		out, err := a.node("tools/install_mission.js", "uninstall", a.loadSettings().GameDir, req.Name)
		writeJSON(w, map[string]any{"ok": err == nil, "output": out})
	})
	return mux
}

// localOnly blocks requests from web pages that reach the local port by other host names.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func message(text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("MiusMissionMaker")
	box.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}

func main() {
	serve := flag.String("serve", "", "serve on this address without opening a window")
	flag.Parse()

	root, err := findRoot()
	if err != nil {
		message(err.Error())
		os.Exit(1)
	}
	base, _ := os.UserConfigDir()
	a := &app{root: root, settings: filepath.Join(base, "MiusMissionMaker", "settings.json")}

	if *serve != "" {
		fmt.Println("http://" + *serve + "/#dev")
		if err := http.ListenAndServe(*serve, localOnly(a.routes("/api/dev"))); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	// the random token keeps other programs and web pages out of the local API
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	token := hex.EncodeToString(secret)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		message(err.Error())
		os.Exit(1)
	}
	go func() { _ = http.Serve(listener, localOnly(a.routes("/api/"+token))) }()

	cache, _ := os.UserCacheDir()
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(cache, "MiusMissionMaker"),
		WindowOptions: webview2.WindowOptions{
			Title: "Mius Mission Maker", Width: 1420, Height: 900, Center: true,
		},
	})
	if view == nil {
		message("Could not open the window. Is the Microsoft Edge WebView2 runtime installed?")
		os.Exit(1)
	}
	defer view.Destroy()
	view.Navigate("http://" + listener.Addr().String() + "/#" + token)
	view.Run()
}
