#include <mach-o/dyld.h>
#include <sys/syslimits.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char executable[PATH_MAX], resolved[PATH_MAX], runtime[PATH_MAX], script[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0 || realpath(executable, resolved) == NULL) return 7;
    char *folder = dirname(resolved);
    if (snprintf(runtime, sizeof(runtime), "%s/lib/node", folder) >= sizeof(runtime) ||
        snprintf(script, sizeof(script), "%s/lib/main.cjs", folder) >= sizeof(script)) return 7;
    char **arguments = calloc((size_t)argc + 2, sizeof(char *));
    if (arguments == NULL) return 7;
    arguments[0] = runtime;
    arguments[1] = script;
    for (int index = 1; index < argc; index++) arguments[index + 1] = argv[index];
    // Match SEA releases: the caller cannot inject Node startup options.
    unsetenv("NODE_OPTIONS");
    unsetenv("NODE_PATH");
    execv(runtime, arguments);
    free(arguments);
    fputs("Cannot start the bundled runtime. Extract the complete release folder and retry.\n", stderr);
    return 7;
}
