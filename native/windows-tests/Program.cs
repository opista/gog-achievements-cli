using System.Text.Json;
using GogLogin;

var result = LoginProtocolTests.Run();
Console.WriteLine(JsonSerializer.Serialize(result));
return (bool)result["self_test_passed"]! ? 0 : 1;
